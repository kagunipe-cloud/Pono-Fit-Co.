import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * GET ?exercise_id=123
 *
 * Returns all PRs for a lift exercise: for each weight, the max reps ever achieved.
 * [{ weight_lbs: number, pr_reps: number }, ...] sorted by weight descending.
 */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const exercise_id = request.nextUrl.searchParams.get("exercise_id");
    const exerciseId = exercise_id != null && exercise_id !== "" ? parseInt(exercise_id, 10) : null;
    if (exerciseId == null || Number.isNaN(exerciseId)) {
      return NextResponse.json({ error: "exercise_id required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const rows = db.prepare(`
      SELECT ws.weight_kg AS weight, ws.reps
      FROM workout_sets ws
      JOIN workout_exercises we ON we.id = ws.workout_exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE w.member_id = ? AND w.finished_at IS NOT NULL
        AND we.exercise_id = ? AND we.type = 'lift'
        AND ws.weight_kg IS NOT NULL AND ws.weight_kg > 0
        AND ws.reps IS NOT NULL AND ws.reps > 0
    `).all(memberId, exerciseId) as { weight: number; reps: number }[];

    db.close();

    // Group by weight (round to 1 decimal to avoid 40 vs 40.0 duplicates)
    const byWeight = new Map<number, number>();
    for (const r of rows) {
      const w = Math.round(r.weight * 10) / 10;
      const reps = r.reps;
      const existing = byWeight.get(w);
      if (existing == null || reps > existing) byWeight.set(w, reps);
    }

    const prs = [...byWeight.entries()]
      .map(([weight_lbs, pr_reps]) => ({ weight_lbs, pr_reps }))
      .sort((a, b) => b.weight_lbs - a.weight_lbs);

    return NextResponse.json({ prs });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load PRs" }, { status: 500 });
  }
}
