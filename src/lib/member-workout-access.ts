import { NextResponse } from "next/server";
import { getDb } from "./db";
import { canAccessMemberExerciseStats } from "./member-exercise-access";

/** Whether sessionMemberId may view or edit workouts owned by targetMemberId. */
export function canAccessMemberWorkout(
  db: ReturnType<typeof getDb>,
  sessionMemberId: string,
  targetMemberId: string
): boolean {
  return canAccessMemberExerciseStats(db, sessionMemberId, targetMemberId);
}

export type WorkoutOwnerAccess =
  | { ok: true; ownerMemberId: string }
  | { ok: false; error: "not_found" | "forbidden" };

/** Resolve the workout owner member_id if session may access this workout. */
export function resolveWorkoutOwnerMemberId(
  db: ReturnType<typeof getDb>,
  sessionMemberId: string,
  workoutId: number
): WorkoutOwnerAccess {
  const row = db.prepare("SELECT member_id FROM workouts WHERE id = ?").get(workoutId) as
    | { member_id: string }
    | undefined;
  if (!row) return { ok: false, error: "not_found" };
  if (row.member_id === sessionMemberId) return { ok: true, ownerMemberId: row.member_id };
  if (canAccessMemberWorkout(db, sessionMemberId, row.member_id)) {
    return { ok: true, ownerMemberId: row.member_id };
  }
  return { ok: false, error: "forbidden" };
}

type WorkoutOwnerResult =
  | { ok: true; ownerMemberId: string }
  | { ok: false; response: NextResponse };

/** Resolve workout owner for API handlers (session + access check). */
export function getWorkoutOwnerForSession(
  sessionMemberId: string | null,
  workoutId: number,
  db: ReturnType<typeof getDb>
): WorkoutOwnerResult {
  if (!sessionMemberId) {
    return { ok: false, response: NextResponse.json({ error: "Not logged in" }, { status: 401 }) };
  }
  const access = resolveWorkoutOwnerMemberId(db, sessionMemberId, workoutId);
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: access.error === "forbidden" ? "Forbidden" : "Not found" },
        { status: access.error === "forbidden" ? 403 : 404 }
      ),
    };
  }
  return { ok: true, ownerMemberId: access.ownerMemberId };
}
