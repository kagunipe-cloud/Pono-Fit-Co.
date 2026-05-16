import type { Database } from "better-sqlite3";
import { estimate1RM } from "@/lib/workout-units";

/**
 * After `workouts.finished_at` is set, updates `member_1rm_records` from this workout’s sets
 * for exercises the member tracks in `member_1rm_settings` (same logic as member “finish workout”).
 */
export function applyMemberWorkoutFinishSideEffects(db: Database, workoutId: number, memberId: string): void {
  const settings = db.prepare("SELECT exercise_id FROM member_1rm_settings WHERE member_id = ?").all(memberId) as { exercise_id: number }[];
  const startedRow = db.prepare("SELECT started_at FROM workouts WHERE id = ?").get(workoutId) as { started_at: string } | undefined;
  const recordedAt = (startedRow?.started_at ?? new Date().toISOString()).slice(0, 19);
  for (const { exercise_id } of settings) {
    const exRows = db.prepare(
      "SELECT we.id FROM workout_exercises we WHERE we.workout_id = ? AND we.exercise_id = ? AND we.type = 'lift'"
    ).all(workoutId, exercise_id) as { id: number }[];
    if (exRows.length === 0) continue;
    let best1RM: number | null = null;
    for (const { id: exId } of exRows) {
      const sets = db.prepare("SELECT reps, weight_kg FROM workout_sets WHERE workout_exercise_id = ?").all(exId) as {
        reps: number | null;
        weight_kg: number | null;
      }[];
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
      ).run(memberId, workoutId, exercise_id, recordedAt, best1RM);
    }
  }
}
