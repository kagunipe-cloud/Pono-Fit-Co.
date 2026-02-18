import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getMemberIdFromSession } from "../../../../../lib/session";
import { ensureWorkoutTables } from "../../../../../lib/workouts";

export const dynamic = "force-dynamic";

async function getWorkoutWithExercises(db: ReturnType<typeof getDb>, workoutId: number, memberId: string) {
  const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
  const cols = ["id", "member_id", "started_at", "finished_at", "source_workout_id", "assigned_by_admin"];
  if (hasName) cols.push("name");
  const workout = db
    .prepare(`SELECT ${cols.join(", ")} FROM workouts WHERE id = ? AND member_id = ?`)
    .get(workoutId, memberId) as { id: number; member_id: string; started_at: string; finished_at: string | null; source_workout_id: number | null; assigned_by_admin: number; name?: string | null } | undefined;
  if (!workout) return null;
  const exercises = db
    .prepare(
      "SELECT id, workout_id, type, exercise_name, sort_order, exercise_id FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id"
    )
    .all(workoutId) as { id: number; workout_id: number; type: string; exercise_name: string; sort_order: number; exercise_id: number | null }[];
  const setCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
  const hasDropIndex = setCols.includes("drop_index");
  const setSelect = hasDropIndex
    ? "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, drop_index, id"
    : "SELECT id, reps, weight_kg, time_seconds, distance_km, set_order FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id";
  const setsByExercise: Record<number, { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[]> = {};
  for (const ex of exercises) {
    const sets = db
      .prepare(setSelect)
      .all(ex.id) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
    setsByExercise[ex.id] = sets;
  }
  return {
    ...workout,
    exercises: exercises.map((e) => ({ ...e, sets: setsByExercise[e.id] ?? [] })),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const workout = await getWorkoutWithExercises(db, id, memberId);
    db.close();
    if (!workout) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(workout);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch workout" }, { status: 500 });
  }
}

/** Finish workout: set finished_at */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
    if (body.finish === true) {
      db.prepare("UPDATE workouts SET finished_at = datetime('now') WHERE id = ?").run(id);
    }
    if (hasName && (typeof body.name === "string" || body.name === null)) {
      const name = body.name === null ? null : (String(body.name).trim() || null);
      db.prepare("UPDATE workouts SET name = ? WHERE id = ? AND member_id = ?").run(name, id, memberId);
    }
    db.close();
    const outDb = getDb();
    const workout = await getWorkoutWithExercises(outDb, id, memberId);
    outDb.close();
    return NextResponse.json(workout ?? {});
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

/** Delete workout (and its exercises/sets via cascade). Member must own the workout. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const exerciseIds = db.prepare("SELECT id FROM workout_exercises WHERE workout_id = ?").all(id) as { id: number }[];
    for (const { id: exId } of exerciseIds) {
      db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ?").run(exId);
    }
    db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(id);
    db.prepare("DELETE FROM workouts WHERE id = ? AND member_id = ?").run(id, memberId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete workout" }, { status: 500 });
  }
}
