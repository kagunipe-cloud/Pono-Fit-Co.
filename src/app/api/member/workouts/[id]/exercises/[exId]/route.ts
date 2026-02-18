import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** PATCH body: { exercise_name?, type?, exercise_id? }. Allowed for open or finished workouts. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const workoutId = parseInt((await params).id, 10);
    const exId = parseInt((await params).exId, 10);
    if (Number.isNaN(workoutId) || Number.isNaN(exId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const row = db
      .prepare("SELECT id, exercise_name, type, exercise_id FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number; exercise_name: string; type: string; exercise_id: number | null } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const exercise_name =
      typeof body.exercise_name === "string" && body.exercise_name.trim()
        ? body.exercise_name.trim()
        : row.exercise_name;
    const type = body.type === "cardio" ? "cardio" : body.type === "lift" ? "lift" : row.type;
    const exercise_id =
      body.exercise_id === null || body.exercise_id === undefined
        ? row.exercise_id
        : typeof body.exercise_id === "number" && body.exercise_id > 0
          ? body.exercise_id
          : null;

    db.prepare(
      "UPDATE workout_exercises SET exercise_name = ?, type = ?, exercise_id = ? WHERE id = ? AND workout_id = ?"
    ).run(exercise_name, type, exercise_id, exId, workoutId);
    const updated = db
      .prepare("SELECT id, workout_id, type, exercise_name, sort_order, exercise_id FROM workout_exercises WHERE id = ?")
      .get(exId) as Record<string, unknown>;
    const setCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = setCols.includes("drop_index");
    const sets = db
      .prepare(
        hasDropIndex
          ? "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, drop_index, id"
          : "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id"
      )
      .all(exId) as Record<string, unknown>[];
    db.close();

    return NextResponse.json({ ...updated, sets });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update exercise" }, { status: 500 });
  }
}

/** DELETE: remove this exercise (and its sets) from the workout. Allowed for open or finished workouts. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const workoutId = parseInt((await params).id, 10);
    const exId = parseInt((await params).exId, 10);
    if (Number.isNaN(workoutId) || Number.isNaN(exId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const ex = db.prepare("SELECT id FROM workout_exercises WHERE id = ? AND workout_id = ?").get(exId, workoutId);
    if (!ex) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    db.prepare("DELETE FROM workout_exercises WHERE id = ? AND workout_id = ?").run(exId, workoutId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete exercise" }, { status: 500 });
  }
}
