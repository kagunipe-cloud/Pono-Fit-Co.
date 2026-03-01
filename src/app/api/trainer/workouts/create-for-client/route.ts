import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrainerMemberId } from "@/lib/admin";
import { ensureWorkoutTables } from "@/lib/workouts";
import { getMuscleGroup } from "@/lib/muscle-groups";

export const dynamic = "force-dynamic";

type ExercisePayload = {
  type: "lift" | "cardio";
  exercise_id?: number;
  exercise_name: string;
  muscle_group?: string;
  primary_muscles?: string;
  equipment?: string;
  instructions?: string[];
  sets: { reps?: number; weight_kg?: number }[] | { time_seconds?: number; distance_km?: number }[];
};

/** POST { client_member_id: string, exercises: ExercisePayload[] }. Trainer only. Creates an unfinished workout for that client (finished_at NULL) so they can fill in sets/reps/weight and "Finish workout and send to trainer". */
export async function POST(request: NextRequest) {
  const trainerId = await getTrainerMemberId(request);
  if (!trainerId) {
    return NextResponse.json({ error: "Trainer only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const client_member_id = (body.client_member_id ?? "").toString().trim();
    const exercises = Array.isArray(body.exercises) ? body.exercises : [];
    const trainer_notes = typeof body.trainer_notes === "string" ? body.trainer_notes.trim() || null : null;

    if (!client_member_id) {
      return NextResponse.json({ error: "client_member_id required" }, { status: 400 });
    }

    const db = getDb();
    const member = db.prepare("SELECT member_id FROM members WHERE member_id = ? LIMIT 1").get(client_member_id) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const isAdmin = db.prepare("SELECT 1 FROM members WHERE member_id = ? AND role = 'Admin'").get(trainerId);
    const canAssign = isAdmin || db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, client_member_id);
    if (!canAssign) {
      db.close();
      return NextResponse.json({ error: "You can only create workouts for your own clients" }, { status: 403 });
    }

    ensureWorkoutTables(db);

    const hasTrainerCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
    if (!hasTrainerCol) {
      db.close();
      return NextResponse.json({ error: "Schema missing assigned_by_trainer_member_id" }, { status: 500 });
    }

    const workoutResult = db
      .prepare(
        "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, assigned_by_trainer_member_id, trainer_notes) VALUES (?, datetime('now'), NULL, 0, ?, ?)"
      )
      .run(member.member_id, trainerId, trainer_notes);
    const workoutId = Number(workoutResult.lastInsertRowid);

    const getOrCreateExercise = db.prepare("SELECT id FROM exercises WHERE name = ? AND type = ? LIMIT 1");
    const getExerciseById = db.prepare("SELECT id FROM exercises WHERE id = ? LIMIT 1");
    const insertExercise = db.prepare(
      "INSERT INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertEx = db.prepare(
      "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)"
    );
    const insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
    );

    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i] as ExercisePayload;
      const type = ex.type === "cardio" ? "cardio" : "lift";
      const exercise_name = String(ex.exercise_name ?? "").trim() || "Exercise";
      const primary_muscles = (ex.primary_muscles ?? "").trim() || "";
      const equipment = (ex.equipment ?? "").trim() || "";
      const muscle_group = (ex.muscle_group ?? "").trim() || getMuscleGroup(primary_muscles || undefined, exercise_name);
      const instructionsArr = Array.isArray(ex.instructions) ? ex.instructions : [];
      const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";

      let exerciseId: number | null = null;
      if (typeof ex.exercise_id === "number" && ex.exercise_id > 0) {
        const row = getExerciseById.get(ex.exercise_id) as { id: number } | undefined;
        if (row) exerciseId = ex.exercise_id;
      }
      if (exerciseId == null) {
        const existing = getOrCreateExercise.get(exercise_name, type) as { id: number } | undefined;
        if (existing) {
          exerciseId = existing.id;
        } else {
          insertExercise.run(exercise_name, type, primary_muscles, "", equipment, muscle_group, instructions);
          const row = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
          exerciseId = row.id;
        }
      }

      const exResult = insertEx.run(workoutId, type, exercise_name, i, exerciseId);
      const workoutExerciseId = Number(exResult.lastInsertRowid);
      const sets = Array.isArray(ex.sets) ? ex.sets : [];

      for (let j = 0; j < sets.length; j++) {
        const s = sets[j] ?? {};
        const reps = type === "lift" ? (typeof (s as { reps?: number }).reps === "number" ? (s as { reps: number }).reps : parseInt(String((s as { reps?: number }).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as { weight_kg?: number }).weight_kg === "number" ? (s as { weight_kg: number }).weight_kg : parseFloat(String((s as { weight_kg?: number }).weight_kg ?? 0)) || null) : null;
        const time_seconds = type === "cardio" ? (typeof (s as { time_seconds?: number }).time_seconds === "number" ? (s as { time_seconds: number }).time_seconds : parseInt(String((s as { time_seconds?: number }).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as { distance_km?: number }).distance_km === "number" ? (s as { distance_km: number }).distance_km : parseFloat(String((s as { distance_km?: number }).distance_km ?? 0)) || null) : null;
        insertSet.run(workoutExerciseId, reps, weight_kg, time_seconds, distance_km, j);
      }
    }

    const row = db.prepare("SELECT id, member_id, started_at, finished_at FROM workouts WHERE id = ?").get(workoutId) as { id: number; member_id: string; started_at: string; finished_at: string | null };
    db.close();

    return NextResponse.json({
      id: row.id,
      member_id: row.member_id,
      started_at: row.started_at,
      finished_at: row.finished_at,
      message: "Workout sent to client. They can open it under Workouts from my trainer, fill in sets/reps/weight, and finish to send results back.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create workout for client" }, { status: 500 });
  }
}
