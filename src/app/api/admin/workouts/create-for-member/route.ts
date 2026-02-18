import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { ensureWorkoutTables } from "../../../../../lib/workouts";

export const dynamic = "force-dynamic";

type ExercisePayload = {
  type: "lift" | "cardio";
  exercise_name: string;
  sets: { reps?: number; weight_kg?: number }[] | { time_seconds?: number; distance_km?: number }[];
};

/** POST { member_email: string, exercises: ExercisePayload[] }. Admin only. Creates a finished workout for that member; they can repeat it from their workouts page. */
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

    const insertEx = db.prepare(
      "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order) VALUES (?, ?, ?, ?)"
    );
    const insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
    );

    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i] as ExercisePayload;
      const type = ex.type === "cardio" ? "cardio" : "lift";
      const exercise_name = String(ex.exercise_name ?? "").trim() || "Exercise";
      const exResult = insertEx.run(workoutId, type, exercise_name, i);
      const exerciseId = Number(exResult.lastInsertRowid);
      const sets = Array.isArray(ex.sets) ? ex.sets : [];

      for (let j = 0; j < sets.length; j++) {
        const s = sets[j] ?? {};
        const reps = type === "lift" ? (typeof (s as { reps?: number }).reps === "number" ? (s as { reps: number }).reps : parseInt(String((s as { reps?: number }).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as { weight_kg?: number }).weight_kg === "number" ? (s as { weight_kg: number }).weight_kg : parseFloat(String((s as { weight_kg?: number }).weight_kg ?? 0)) || null) : null;
        const time_seconds = type === "cardio" ? (typeof (s as { time_seconds?: number }).time_seconds === "number" ? (s as { time_seconds: number }).time_seconds : parseInt(String((s as { time_seconds?: number }).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as { distance_km?: number }).distance_km === "number" ? (s as { distance_km: number }).distance_km : parseFloat(String((s as { distance_km?: number }).distance_km ?? 0)) || null) : null;
        insertSet.run(exerciseId, reps, weight_kg, time_seconds, distance_km, j);
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
