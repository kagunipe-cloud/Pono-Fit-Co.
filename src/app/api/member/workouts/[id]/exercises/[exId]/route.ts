import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables, estimate1RM } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** PATCH body: { exercise_name?, type?, exercise_id?, use_for_my_1rm? }. Allowed for open or finished workouts. */
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

    const use_for_my_1rm = body.use_for_my_1rm === true;
    const effectiveExId = exercise_id ?? row.exercise_id;
    const hasUseForMy1rm = (db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[]).some((c) => c.name === "use_for_my_1rm");

    if (hasUseForMy1rm) {
      db.prepare(
        "UPDATE workout_exercises SET exercise_name = ?, type = ?, exercise_id = ?, use_for_my_1rm = ? WHERE id = ? AND workout_id = ?"
      ).run(exercise_name, type, exercise_id, use_for_my_1rm ? 1 : 0, exId, workoutId);
    } else {
      db.prepare(
        "UPDATE workout_exercises SET exercise_name = ?, type = ?, exercise_id = ? WHERE id = ? AND workout_id = ?"
      ).run(exercise_name, type, exercise_id, exId, workoutId);
    }

    if (type === "lift" && effectiveExId != null) {
      if (use_for_my_1rm) {
        db.prepare("INSERT OR REPLACE INTO member_1rm_settings (member_id, exercise_id) VALUES (?, ?)").run(memberId, effectiveExId);
        // If workout is already finished, backfill 1RM from existing sets so the amount shows immediately
        const workoutRow = db.prepare("SELECT finished_at, started_at FROM workouts WHERE id = ?").get(workoutId) as { finished_at: string | null; started_at: string } | undefined;
        if (workoutRow?.finished_at) {
          const sets = db.prepare("SELECT reps, weight_kg FROM workout_sets WHERE workout_exercise_id = ?").all(exId) as { reps: number | null; weight_kg: number | null }[];
          let best1RM: number | null = null;
          for (const s of sets) {
            const reps = s.reps ?? 0;
            const w = s.weight_kg ?? 0;
            if (w > 0 && reps > 0) {
              const est = estimate1RM(w, Math.min(36, reps));
              if (est != null && (best1RM == null || est > best1RM)) best1RM = est;
            }
          }
          if (best1RM != null && best1RM > 0) {
            const recordedAt = (workoutRow.started_at ?? new Date().toISOString()).slice(0, 19);
            db.prepare(
              "INSERT INTO member_1rm_records (member_id, workout_id, exercise_id, recorded_at, estimated_1rm_lbs) VALUES (?, ?, ?, ?, ?)"
            ).run(memberId, workoutId, effectiveExId, recordedAt, best1RM);
          }
        }
      } else {
        db.prepare("DELETE FROM member_1rm_settings WHERE member_id = ? AND exercise_id = ?").run(memberId, effectiveExId);
      }
    }
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
