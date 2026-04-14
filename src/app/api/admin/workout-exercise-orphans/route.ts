import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export type WorkoutExerciseOrphanRow = {
  workout_exercise_id: number;
  workout_id: number;
  stale_exercise_id: number;
  exercise_name: string;
  exercise_type: string;
  member_id: string;
  member_name: string;
};

function memberDisplay(first: string | null, last: string | null, memberId: string): string {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || memberId;
}

/**
 * GET — list workout_exercises rows whose exercise_id does not exist in exercises (broken FK target).
 * POST { "confirm": true } — set those exercise_id to NULL; remove orphan member_1rm_settings rows.
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    ensureWorkoutTables(db);

    const raw = db
      .prepare(
        `SELECT we.id AS workout_exercise_id,
                we.workout_id,
                we.exercise_id AS stale_exercise_id,
                we.exercise_name,
                we.type AS exercise_type,
                w.member_id,
                m.first_name,
                m.last_name
         FROM workout_exercises we
         JOIN workouts w ON w.id = we.workout_id
         LEFT JOIN members m ON m.member_id = w.member_id
         WHERE we.exercise_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM exercises e WHERE e.id = we.exercise_id)
         ORDER BY we.id`
      )
      .all() as {
      workout_exercise_id: number;
      workout_id: number;
      stale_exercise_id: number;
      exercise_name: string;
      exercise_type: string;
      member_id: string;
      first_name: string | null;
      last_name: string | null;
    }[];

    db.close();

    const rows: WorkoutExerciseOrphanRow[] = raw.map((r) => ({
      workout_exercise_id: r.workout_exercise_id,
      workout_id: r.workout_id,
      stale_exercise_id: r.stale_exercise_id,
      exercise_name: r.exercise_name,
      exercise_type: r.exercise_type,
      member_id: r.member_id,
      member_name: memberDisplay(r.first_name, r.last_name, r.member_id),
    }));

    return NextResponse.json({ count: rows.length, rows });
  } catch (err) {
    console.error("[admin/workout-exercise-orphans GET]", err);
    return NextResponse.json({ error: "Failed to load orphan references" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirm?: boolean };
  try {
    body = (await request.json()) as { confirm?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Send { "confirm": true } to unlink broken exercise_id values.' }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureWorkoutTables(db);

    const upd = db
      .prepare(
        `UPDATE workout_exercises
         SET exercise_id = NULL
         WHERE exercise_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM exercises e WHERE e.id = workout_exercises.exercise_id)`
      )
      .run();

    let settingsRemoved = 0;
    try {
      const del = db
        .prepare(
          `DELETE FROM member_1rm_settings
           WHERE exercise_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM exercises e WHERE e.id = member_1rm_settings.exercise_id)`
        )
        .run();
      settingsRemoved = del.changes;
    } catch {
      /* table may be missing in edge DBs */
    }

    db.close();

    return NextResponse.json({
      ok: true,
      workout_exercises_unlinked: upd.changes,
      member_1rm_settings_removed: settingsRemoved,
    });
  } catch (err) {
    console.error("[admin/workout-exercise-orphans POST]", err);
    return NextResponse.json({ error: "Failed to repair references" }, { status: 500 });
  }
}
