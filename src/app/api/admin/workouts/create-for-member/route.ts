import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
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

/** POST { member_email: string, exercises: ExercisePayload[] }. Admin only. Creates a finished workout for that member; links to exercises table (creating exercise if needed) so member gets name, muscle group, target muscle, equipment, instructions. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const member_email = (body.member_email ?? "").toString().trim();
    const exercises = Array.isArray(body.exercises) ? body.exercises : [];

    if (!member_email) {
      return NextResponse.json({ error: "member_email required" }, { status: 400 });
    }

    const db = getDb();
    const member = db
      .prepare("SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1")
      .get(member_email.toLowerCase()) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "No member found with that email" }, { status: 404 });
    }

    ensureWorkoutTables(db);

    const workoutResult = db
      .prepare(
        "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin) VALUES (?, datetime('now'), datetime('now'), 1)"
      )
      .run(member.member_id);
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
      message: "Workout posted to member's page. They can repeat it from their Workouts list.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create workout for member" }, { status: 500 });
  }
}
