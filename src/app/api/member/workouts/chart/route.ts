import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * GET ?exercise_id=123 — history for one official exercise for the logged-in member.
 * Returns points for charting: { date, volume_lbs?, max_weight_lbs?, reps?, time_seconds?, distance_km? }.
 * Only includes workouts that are finished and where the exercise was linked to this exercise_id.
 */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const exercise_id = parseInt(request.nextUrl.searchParams.get("exercise_id") ?? "", 10);
    if (Number.isNaN(exercise_id) || exercise_id < 1) {
      return NextResponse.json({ error: "exercise_id required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const ex = db.prepare("SELECT id, name, type FROM exercises WHERE id = ?").get(exercise_id) as { id: number; name: string; type: string } | undefined;
    if (!ex) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const workoutExRows = db.prepare(`
      SELECT we.id AS workout_exercise_id, w.started_at, w.finished_at
      FROM workout_exercises we
      JOIN workouts w ON w.id = we.workout_id
      WHERE w.member_id = ? AND w.finished_at IS NOT NULL AND we.exercise_id = ?
      ORDER BY w.started_at
    `).all(memberId, exercise_id) as { workout_exercise_id: number; started_at: string; finished_at: string | null }[];

    const points: { date: string; volume_lbs?: number; max_weight_lbs?: number; reps?: number; time_seconds?: number; distance_km?: number }[] = [];

    for (const row of workoutExRows) {
      const date = (row.started_at ?? "").slice(0, 10);
      const sets = db.prepare(
        "SELECT reps, weight_kg, time_seconds, distance_km FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order"
      ).all(row.workout_exercise_id) as { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null }[];

      if (ex.type === "lift") {
        let volume = 0;
        let maxWeight: number | null = null;
        let totalReps = 0;
        for (const s of sets) {
          const reps = s.reps ?? 0;
          const w = s.weight_kg ?? 0; // stored as kg in DB but we display lbs in UI - assume stored as lbs for now or convert
          volume += reps * w;
          if (s.weight_kg != null && (maxWeight == null || s.weight_kg > maxWeight)) maxWeight = s.weight_kg;
          totalReps += reps;
        }
        points.push({
          date,
          ...(volume > 0 && { volume_lbs: Math.round(volume) }),
          ...(maxWeight != null && { max_weight_lbs: maxWeight }),
          ...(totalReps > 0 && { reps: totalReps }),
        });
      } else {
        let time = 0;
        let distance = 0;
        for (const s of sets) {
          time += s.time_seconds ?? 0;
          distance += s.distance_km ?? 0;
        }
        points.push({
          date,
          ...(time > 0 && { time_seconds: time }),
          ...(distance > 0 && { distance_km: distance }),
        });
      }
    }

    db.close();
    return NextResponse.json({ exercise: { id: ex.id, name: ex.name, type: ex.type }, points });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load chart data" }, { status: 500 });
  }
}
