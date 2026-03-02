import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getMemberIdFromSession } from "../../../../../lib/session";
import { ensureWorkoutTables, estimate1RM } from "../../../../../lib/workouts";

export const dynamic = "force-dynamic";

async function getWorkoutWithExercises(db: ReturnType<typeof getDb>, workoutId: number, memberId: string) {
  const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
  const hasTrainer = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
  const hasTrainerNotes = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "trainer_notes");
  const hasClientNotes = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "client_completion_notes");
  const cols = ["id", "member_id", "started_at", "finished_at", "source_workout_id", "assigned_by_admin"];
  if (hasName) cols.push("name");
  if (hasTrainer) cols.push("assigned_by_trainer_member_id");
  if (hasTrainerNotes) cols.push("trainer_notes");
  if (hasClientNotes) cols.push("client_completion_notes");
  const workout = db
    .prepare(`SELECT ${cols.join(", ")} FROM workouts WHERE id = ? AND member_id = ?`)
    .get(workoutId, memberId) as { id: number; member_id: string; started_at: string; finished_at: string | null; source_workout_id: number | null; assigned_by_admin: number; name?: string | null; assigned_by_trainer_member_id?: string | null; trainer_notes?: string | null; client_completion_notes?: string | null } | undefined;
  if (!workout) return null;
  const hasUseForMy1rm = (db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[]).some((c) => c.name === "use_for_my_1rm");
  const exerciseCols = ["id", "workout_id", "type", "exercise_name", "sort_order", "exercise_id"];
  if (hasUseForMy1rm) exerciseCols.push("use_for_my_1rm");
  const exercises = db
    .prepare(
      `SELECT ${exerciseCols.join(", ")} FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id`
    )
    .all(workoutId) as { id: number; workout_id: number; type: string; exercise_name: string; sort_order: number; exercise_id: number | null; use_for_my_1rm?: number }[];
  const setCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
  const hasDropIndex = setCols.includes("drop_index");
  const setSelect = hasDropIndex
    ? "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, drop_index, id"
    : "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id";
  const setsByExercise: Record<number, { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[]> = {};
  for (const ex of exercises) {
    const sets = db
      .prepare(setSelect)
      .all(ex.id) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
    setsByExercise[ex.id] = sets;
  }
  return {
    ...workout,
    exercises: exercises.map((e) => ({ ...e, sets: setsByExercise[e.id] ?? [] })),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const workout = await getWorkoutWithExercises(db, id, memberId);
    db.close();
    if (!workout) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(workout);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch workout" }, { status: 500 });
  }
}

/** Finish workout: set finished_at */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
    if (body.finish === true) {
      db.prepare("UPDATE workouts SET finished_at = datetime('now') WHERE id = ?").run(id);
      const clientNotes = typeof body.client_completion_notes === "string" ? body.client_completion_notes.trim() || null : null;
      const hasClientNotesCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "client_completion_notes");
      if (hasClientNotesCol && clientNotes !== undefined) {
        db.prepare("UPDATE workouts SET client_completion_notes = ? WHERE id = ? AND member_id = ?").run(clientNotes, id, memberId);
      }
      // Update My 1RM for each designated exercise present in this workout
      const settings = db.prepare("SELECT exercise_id FROM member_1rm_settings WHERE member_id = ?").all(memberId) as { exercise_id: number }[];
      const startedAt = db.prepare("SELECT started_at FROM workouts WHERE id = ?").get(id) as { started_at: string };
      const recordedAt = (startedAt?.started_at ?? new Date().toISOString()).slice(0, 19);
      for (const { exercise_id } of settings) {
        const exRows = db.prepare(
          "SELECT we.id FROM workout_exercises we WHERE we.workout_id = ? AND we.exercise_id = ? AND we.type = 'lift'"
        ).all(id, exercise_id) as { id: number }[];
        if (exRows.length === 0) continue;
        let best1RM: number | null = null;
        for (const { id: exId } of exRows) {
          const sets = db.prepare("SELECT reps, weight_kg FROM workout_sets WHERE workout_exercise_id = ?").all(exId) as { reps: number | null; weight_kg: number | null }[];
          for (const s of sets) {
            const reps = s.reps ?? 0;
            const w = s.weight_kg ?? 0;
            if (w > 0 && reps > 0) {
              const est = estimate1RM(w, Math.min(36, reps));
              if (est != null && (best1RM == null || est > best1RM)) best1RM = est;
            }
          }
        }
        if (best1RM != null && best1RM > 0) {
          db.prepare(
            "INSERT INTO member_1rm_records (member_id, workout_id, exercise_id, recorded_at, estimated_1rm_lbs) VALUES (?, ?, ?, ?, ?)"
          ).run(memberId, id, exercise_id, recordedAt, best1RM);
        }
      }
    }
    if (hasName && (typeof body.name === "string" || body.name === null)) {
      const name = body.name === null ? null : (String(body.name).trim() || null);
      db.prepare("UPDATE workouts SET name = ? WHERE id = ? AND member_id = ?").run(name, id, memberId);
    }
    db.close();
    const outDb = getDb();
    const workout = await getWorkoutWithExercises(outDb, id, memberId);
    outDb.close();
    return NextResponse.json(workout ?? {});
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

/** Delete workout (and its exercises/sets via cascade). Member must own the workout. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const exerciseIds = db.prepare("SELECT id FROM workout_exercises WHERE workout_id = ?").all(id) as { id: number }[];
    for (const { id: exId } of exerciseIds) {
      db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ?").run(exId);
    }
    db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(id);
    db.prepare("DELETE FROM workouts WHERE id = ? AND member_id = ?").run(id, memberId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete workout" }, { status: 500 });
  }
}
