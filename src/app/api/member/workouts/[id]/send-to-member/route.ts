import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * POST { recipient_email: string }.
 * Copies this finished workout (exercises + sets) to the recipient's account as a new finished workout.
 * Member-only; you can't send to yourself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const senderId = await getMemberIdFromSession();
    if (!senderId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const idParam = (await params).id;
    const workoutId = parseInt(idParam, 10);
    if (Number.isNaN(workoutId)) return NextResponse.json({ error: "Invalid workout id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const recipientEmail = (body.recipient_email ?? "").toString().trim().toLowerCase();
    if (!recipientEmail) {
      return NextResponse.json({ error: "recipient_email is required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id, member_id, finished_at, name FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, senderId) as { id: number; member_id: string; finished_at: string | null; name?: string | null } | undefined;
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (!workout.finished_at) {
      db.close();
      return NextResponse.json({ error: "Only finished workouts can be sent. Finish this workout first." }, { status: 400 });
    }

    const recipient = db.prepare("SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1").get(recipientEmail) as { member_id: string } | undefined;
    if (!recipient) {
      db.close();
      return NextResponse.json({ error: "No member found with that email" }, { status: 404 });
    }
    if (recipient.member_id === senderId) {
      db.close();
      return NextResponse.json({ error: "You cannot send a workout to yourself" }, { status: 400 });
    }

    const hasUseForMy1rm = (db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[]).some((c) => c.name === "use_for_my_1rm");
    const exercises = db.prepare(
      hasUseForMy1rm
        ? "SELECT id, type, exercise_name, sort_order, exercise_id, use_for_my_1rm FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id"
        : "SELECT id, type, exercise_name, sort_order, exercise_id FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id"
    ).all(workoutId) as { id: number; type: string; exercise_name: string; sort_order: number; exercise_id: number | null; use_for_my_1rm?: number }[];
    if (exercises.length === 0) {
      db.close();
      return NextResponse.json({ error: "This workout has no exercises to share" }, { status: 400 });
    }

    const setCols = db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[];
    const hasDropIndex = setCols.some((c) => c.name === "drop_index");

    /** exercise_id FK must point at a real exercises row; old workouts may reference deleted IDs. */
    const exerciseExists = db.prepare("SELECT 1 FROM exercises WHERE id = ?");

    const workoutName = workout.name?.trim() || null;
    const insertWorkout = db.prepare("INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, name) VALUES (?, datetime('now'), datetime('now'), 0, ?)");
    const insertEx = hasUseForMy1rm
      ? db.prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id, use_for_my_1rm) VALUES (?, ?, ?, ?, ?, ?)")
      : db.prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)");
    const insertSet = hasDropIndex
      ? db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
      : db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
        );

    const workoutInsert = insertWorkout.run(recipient.member_id, workoutName);
    const newId = Number(workoutInsert.lastInsertRowid);
    if (!Number.isFinite(newId) || newId < 1) {
      db.close();
      return NextResponse.json({ error: "Failed to create workout copy" }, { status: 500 });
    }

    const setsSelectSql = hasDropIndex
      ? "SELECT reps, weight_kg, time_seconds, distance_km, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id"
      : "SELECT reps, weight_kg, time_seconds, distance_km, set_order FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id";

    for (const ex of exercises) {
      const type = ex.type === "cardio" ? "cardio" : "lift";
      const rawExId = ex.exercise_id != null && ex.exercise_id > 0 ? ex.exercise_id : null;
      const exerciseId =
        rawExId != null && exerciseExists.get(rawExId) != null ? rawExId : null;
      const useForMy1rm = hasUseForMy1rm && type === "lift" && exerciseId != null && (ex.use_for_my_1rm ?? 0) === 1;
      const exResult = hasUseForMy1rm
        ? insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId, useForMy1rm ? 1 : 0)
        : insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId);
      if (useForMy1rm && exerciseId != null) {
        db.prepare("INSERT OR REPLACE INTO member_1rm_settings (member_id, exercise_id) VALUES (?, ?)").run(recipient.member_id, exerciseId);
      }
      const newExId = Number(exResult.lastInsertRowid);
      const sets = db.prepare(setsSelectSql).all(ex.id) as {
        reps: number | null;
        weight_kg: number | null;
        time_seconds: number | null;
        distance_km: number | null;
        set_order: number;
        drop_index?: number;
      }[];
      for (const s of sets) {
        if (hasDropIndex) {
          insertSet.run(
            newExId,
            s.reps,
            s.weight_kg,
            s.time_seconds,
            s.distance_km,
            s.set_order,
            s.drop_index != null ? s.drop_index : 0
          );
        } else {
          insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order);
        }
      }
    }

    db.close();
    return NextResponse.json({
      ok: true,
      message: `Workout sent to ${recipientEmail}. They'll see it in their Workouts list and can repeat it.`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to send workout" }, { status: 500 });
  }
}
