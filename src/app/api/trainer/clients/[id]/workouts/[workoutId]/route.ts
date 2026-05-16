import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrainerMemberId, getAdminMemberId } from "@/lib/admin";
import { ensureWorkoutTables } from "@/lib/workouts-server";
import { ensureTrainerClientsTable } from "@/lib/trainer-clients";
import { kmToMiles } from "@/lib/workouts";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";
import {
  clearWorkoutExerciseContent,
  populateTrainerAssignedWorkoutContent,
} from "@/lib/trainer-assigned-workout-content";

export const dynamic = "force-dynamic";

function parseInstructionsJson(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  try {
    const arr = JSON.parse(s) as unknown;
    return Array.isArray(arr) ? arr.map(String).join("\n") : s;
  } catch {
    return s;
  }
}

async function authorizeTrainerForClientWorkout(
  db: ReturnType<typeof getDb>,
  trainerId: string | null,
  adminId: string | null,
  clientMemberId: string,
  workoutId: number
): Promise<
  | { ok: true; workout: { id: number; member_id: string; finished_at: string | null; assigned_by_trainer_member_id: string | null } }
  | { ok: false; status: number; error: string }
> {
  ensureTrainerClientsTable(db);
  const isAdmin = !!adminId;
  if (!trainerId && !isAdmin) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!clientMemberId) {
    return { ok: false, status: 400, error: "Client id required" };
  }
  if (!isAdmin) {
    const link = db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, clientMemberId);
    if (!link) {
      return { ok: false, status: 403, error: "You can only manage your own clients" };
    }
  }

  ensureWorkoutTables(db);
  const hasTrainerCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
  if (!hasTrainerCol) {
    return { ok: false, status: 500, error: "Schema missing assigned_by_trainer_member_id" };
  }

  const workout = db
    .prepare(
      "SELECT id, member_id, finished_at, assigned_by_trainer_member_id FROM workouts WHERE id = ? AND member_id = ? AND assigned_by_trainer_member_id IS NOT NULL LIMIT 1"
    )
    .get(workoutId, clientMemberId) as
    | { id: number; member_id: string; finished_at: string | null; assigned_by_trainer_member_id: string | null }
    | undefined;

  if (!workout) {
    return { ok: false, status: 404, error: "Workout not found" };
  }

  if (!isAdmin && workout.assigned_by_trainer_member_id !== trainerId) {
    return { ok: false, status: 403, error: "You can only edit workouts you assigned" };
  }

  return { ok: true, workout };
}

/** GET — Single assigned workout formatted for the trainer create/edit form. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const trainerId = await getTrainerMemberId(_request);
  const adminId = await getAdminMemberId(_request);

  const clientMemberId = (await params).id?.trim();
  const workoutId = parseInt(String((await params).workoutId), 10);
  if (!clientMemberId || !Number.isFinite(workoutId) || workoutId <= 0) {
    return NextResponse.json({ error: "Invalid client or workout" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authorizeTrainerForClientWorkout(db, trainerId, adminId, clientMemberId, workoutId);
  if (!auth.ok) {
    db.close();
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const hasNotes = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "trainer_notes");
  let trainer_notes: string | null = null;
  if (hasNotes) {
    const row = db.prepare("SELECT trainer_notes FROM workouts WHERE id = ?").get(workoutId) as { trainer_notes: string | null } | undefined;
    trainer_notes = row?.trainer_notes ?? null;
  }

  const hasUseCol = (db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[]).some((c) => c.name === "use_for_my_1rm");

  const rows = db
    .prepare(
      `SELECT we.id AS workout_exercise_id, we.type, we.exercise_name, we.exercise_id,
              ${hasUseCol ? "we.use_for_my_1rm" : "0 AS use_for_my_1rm"},
              e.primary_muscles, e.equipment, e.muscle_group, e.instructions AS exercise_instructions
       FROM workout_exercises we
       LEFT JOIN exercises e ON e.id = we.exercise_id
       WHERE we.workout_id = ?
       ORDER BY we.sort_order, we.id`
    )
    .all(workoutId) as {
      workout_exercise_id: number;
      type: string;
      exercise_name: string;
      exercise_id: number | null;
      use_for_my_1rm?: number | null;
      primary_muscles: string | null;
      equipment: string | null;
      muscle_group: string | null;
      exercise_instructions: string | null;
    }[];

  const exercises: Record<string, unknown>[] = [];

  for (const ex of rows) {
    const sets = db
      .prepare("SELECT reps, weight_kg, time_seconds, distance_km FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id")
      .all(ex.workout_exercise_id) as { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null }[];

    const instructionsCombined = parseInstructionsJson(ex.exercise_instructions) || "";

    const base = {
      type: ex.type === "cardio" ? "cardio" : "lift",
      exercise_name: ex.exercise_name,
      exercise_id: ex.exercise_id && ex.exercise_id > 0 ? ex.exercise_id : undefined,
      muscle_group: ex.muscle_group?.trim() || undefined,
      primary_muscles: ex.primary_muscles?.trim() || undefined,
      equipment: ex.equipment?.trim() || undefined,
      instructions: instructionsCombined || undefined,
      use_for_my_1rm: !!(ex.use_for_my_1rm && ex.type === "lift"),
    };

    if (ex.type === "cardio") {
      exercises.push({
        ...base,
        sets: sets.map((s) => ({
          time: s.time_seconds != null ? String(Math.round(s.time_seconds / 60)) : "",
          distance: s.distance_km != null ? String(Math.round(kmToMiles(s.distance_km) * 100) / 100) : "",
        })),
      });
    } else {
      exercises.push({
        ...base,
        sets: sets.map((s) => ({
          reps: s.reps != null ? String(s.reps) : "",
          weight: s.weight_kg != null ? String(s.weight_kg) : "",
        })),
      });
    }
  }

  db.close();

  return NextResponse.json({
    id: workoutId,
    trainer_notes: trainer_notes ?? "",
    exercises,
    finished_at: auth.workout.finished_at,
  });
}

/** PATCH — Replace exercises / notes on an assigned workout the client has not finished yet. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const trainerId = await getTrainerMemberId(request);
  const adminId = await getAdminMemberId(request);

  const clientMemberId = (await params).id?.trim();
  const workoutId = parseInt(String((await params).workoutId), 10);
  if (!clientMemberId || !Number.isFinite(workoutId) || workoutId <= 0) {
    return NextResponse.json({ error: "Invalid client or workout" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const exercises = Array.isArray(body.exercises) ? body.exercises : [];
  const trainer_notes =
    "trainer_notes" in body
      ? typeof body.trainer_notes === "string"
        ? body.trainer_notes.trim() || null
        : null
      : undefined;

  const db = getDb();
  const auth = await authorizeTrainerForClientWorkout(db, trainerId, adminId, clientMemberId, workoutId);
  if (!auth.ok) {
    db.close();
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (auth.workout.finished_at) {
    db.close();
    return NextResponse.json(
      { error: "This workout is already completed; ask the member to duplicate it or assign a new workout." },
      { status: 409 }
    );
  }

  if (exercises.length === 0) {
    db.close();
    return NextResponse.json({ error: "Add at least one exercise." }, { status: 400 });
  }

  try {
    clearWorkoutExerciseContent(db, workoutId);
    populateTrainerAssignedWorkoutContent(db, workoutId, clientMemberId, exercises as TrainerAssignedExercisePayload[]);

    const hasNotes = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "trainer_notes");
    if (hasNotes && trainer_notes !== undefined) {
      db.prepare("UPDATE workouts SET trainer_notes = ? WHERE id = ?").run(trainer_notes, workoutId);
    }

    db.close();
    return NextResponse.json({
      ok: true,
      id: workoutId,
      message: "Workout updated. The client will see changes when they refresh the workout.",
    });
  } catch (err) {
    console.error(err);
    db.close();
    return NextResponse.json({ error: "Failed to update workout" }, { status: 500 });
  }
}
