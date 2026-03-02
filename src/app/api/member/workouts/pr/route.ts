import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * GET ?exercise_id=123&exercise_name=Bulgarian%20Split%20Squat&weight=40&exclude_workout_id=456
 *
 * Returns PR and last-session info for a lift exercise at a given weight.
 * - pr_reps: max reps at this weight (all time)
 * - last_session_reps: max reps at this weight from the most recent previous session
 * - last_session_date: date of that session
 *
 * Use exercise_id when the exercise is linked to an official exercise; otherwise use exercise_name.
 * exclude_workout_id: optional current workout ID to exclude from "last session" (so we don't count in-progress sets).
 */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const exercise_id = request.nextUrl.searchParams.get("exercise_id");
    const exercise_name = request.nextUrl.searchParams.get("exercise_name")?.trim();
    const weightParam = request.nextUrl.searchParams.get("weight");
    const exclude_workout_id = request.nextUrl.searchParams.get("exclude_workout_id");

    const weight = weightParam != null && weightParam !== "" ? parseFloat(weightParam) : null;
    if (weight == null || Number.isNaN(weight) || weight <= 0) {
      return NextResponse.json({ error: "weight required and must be a positive number" }, { status: 400 });
    }

    const exerciseId = exercise_id != null && exercise_id !== "" ? parseInt(exercise_id, 10) : null;
    if ((exerciseId == null || Number.isNaN(exerciseId)) && !exercise_name) {
      return NextResponse.json({ error: "exercise_id or exercise_name required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    // Weight tolerance: match within 0.05 lbs (handles 40 vs 40.0)
    const weightLo = weight - 0.05;
    const weightHi = weight + 0.05;

    type Row = { reps: number; workout_id: number; started_at: string };
    let rows: Row[] = [];

    if (exerciseId != null && !Number.isNaN(exerciseId)) {
      rows = db.prepare(`
        SELECT ws.reps, w.id AS workout_id, w.started_at
        FROM workout_sets ws
        JOIN workout_exercises we ON we.id = ws.workout_exercise_id
        JOIN workouts w ON w.id = we.workout_id
        WHERE w.member_id = ? AND w.finished_at IS NOT NULL
          AND we.exercise_id = ? AND we.type = 'lift'
          AND ws.weight_kg IS NOT NULL AND ws.weight_kg >= ? AND ws.weight_kg <= ?
          AND ws.reps IS NOT NULL AND ws.reps > 0
      `).all(memberId, exerciseId, weightLo, weightHi) as Row[];
    } else if (exercise_name) {
      rows = db.prepare(`
        SELECT ws.reps, w.id AS workout_id, w.started_at
        FROM workout_sets ws
        JOIN workout_exercises we ON we.id = ws.workout_exercise_id
        JOIN workouts w ON w.id = we.workout_id
        WHERE w.member_id = ? AND w.finished_at IS NOT NULL
          AND LOWER(TRIM(we.exercise_name)) = LOWER(?)
          AND we.type = 'lift'
          AND ws.weight_kg IS NOT NULL AND ws.weight_kg >= ? AND ws.weight_kg <= ?
          AND ws.reps IS NOT NULL AND ws.reps > 0
      `).all(memberId, exercise_name, weightLo, weightHi) as Row[];
    }

    db.close();

    // PR: max reps across all sessions
    const pr_reps = rows.length > 0 ? Math.max(...rows.map((r) => r.reps)) : null;

    // Last session: most recent session (by started_at) excluding current workout
    const excludeId = exclude_workout_id != null && exclude_workout_id !== "" ? parseInt(exclude_workout_id, 10) : null;
    const byWorkout = new Map<number, { maxReps: number; started_at: string }>();
    for (const r of rows) {
      if (excludeId != null && r.workout_id === excludeId) continue;
      const existing = byWorkout.get(r.workout_id);
      const reps = r.reps;
      if (!existing || reps > existing.maxReps) {
        byWorkout.set(r.workout_id, { maxReps: reps, started_at: r.started_at });
      }
    }
    const sessions = [...byWorkout.entries()]
      .map(([workout_id, data]) => ({ workout_id, ...data }))
      .sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
    const lastSession = sessions[0] ?? null;

    return NextResponse.json({
      pr_reps,
      last_session_reps: lastSession?.maxReps ?? null,
      last_session_date: lastSession?.started_at?.slice(0, 10) ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load PR" }, { status: 500 });
  }
}
