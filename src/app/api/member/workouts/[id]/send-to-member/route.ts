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

    const exercises = db.prepare("SELECT id, type, exercise_name, sort_order, exercise_id FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id").all(workoutId) as { id: number; type: string; exercise_name: string; sort_order: number; exercise_id: number | null }[];
    if (exercises.length === 0) {
      db.close();
      return NextResponse.json({ error: "This workout has no exercises to share" }, { status: 400 });
    }

    const setCols = db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[];
    const hasDropIndex = setCols.some((c) => c.name === "drop_index");

    const workoutName = workout.name?.trim() || null;
    const insertWorkout = db.prepare("INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, name) VALUES (?, datetime('now'), datetime('now'), 0, ?)");
    const insertEx = db.prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)");
    const insertSet = db.prepare("INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)");

    insertWorkout.run(recipient.member_id, workoutName);
    const newWorkoutId = db.prepare("SELECT last_insert_rowid()").get() as { "last_insert_rowid()": number };
    const newId = newWorkoutId["last_insert_rowid()"];

    for (const ex of exercises) {
      const type = ex.type === "cardio" ? "cardio" : "lift";
      insertEx.run(newId, type, ex.exercise_name, ex.sort_order, ex.exercise_id);
      const newExRow = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
      const newExId = newExRow.id;
      const sets = db.prepare("SELECT reps, weight_kg, time_seconds, distance_km, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id").all(ex.id) as { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
      for (const s of sets) {
        insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order, hasDropIndex && s.drop_index != null ? s.drop_index : 0);
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
