import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getMemberIdFromSession } from "../../../../../../lib/session";
import { ensureWorkoutTables } from "../../../../../../lib/workouts";

export const dynamic = "force-dynamic";

/** POST body: { type, exercise_name, exercise_id? (optional; when set, enables chart history), sets } */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const workoutId = parseInt((await params).id, 10);
    if (Number.isNaN(workoutId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const type = body.type === "cardio" ? "cardio" : "lift";
    const exercise_name = String(body.exercise_name ?? "").trim() || "Exercise";
    const exercise_id = typeof body.exercise_id === "number" && body.exercise_id > 0 ? body.exercise_id : null;
    const sets = Array.isArray(body.sets) ? body.sets : [];

    const db = getDb();
    ensureWorkoutTables(db);
    const workout = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM workout_exercises WHERE workout_id = ?").get(workoutId) as { m: number };
    const sort_order = (maxOrder?.m ?? -1) + 1;

    const exResult = db
      .prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)")
      .run(workoutId, type, exercise_name, sort_order, exercise_id);
    const exerciseId = exResult.lastInsertRowid as number;

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const insertSetStmt = hasDropIndex
      ? db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
      : db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
        );

    const isGrouped = sets.length > 0 && Array.isArray(sets[0]);
    if (isGrouped) {
      for (let setOrder = 0; setOrder < sets.length; setOrder++) {
        const group = (sets[setOrder] ?? []) as { reps?: number; weight_kg?: number; time_seconds?: number; distance_km?: number }[];
        for (let dropIndex = 0; dropIndex < group.length; dropIndex++) {
          const s = group[dropIndex] ?? {};
          const reps = type === "lift" ? (typeof s.reps === "number" ? s.reps : parseInt(String(s.reps ?? 0), 10) || null) : null;
          const weight_kg = type === "lift" ? (typeof s.weight_kg === "number" ? s.weight_kg : parseFloat(String(s.weight_kg ?? 0)) || null) : null;
          const time_seconds = type === "cardio" ? (typeof s.time_seconds === "number" ? s.time_seconds : parseInt(String(s.time_seconds ?? 0), 10) || null) : null;
          const distance_km = type === "cardio" ? (typeof s.distance_km === "number" ? s.distance_km : parseFloat(String(s.distance_km ?? 0)) || null) : null;
          if (hasDropIndex) insertSetStmt.run(exerciseId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex);
          else insertSetStmt.run(exerciseId, reps, weight_kg, time_seconds, distance_km, setOrder);
        }
      }
    } else {
      for (let i = 0; i < sets.length; i++) {
        const s = (sets[i] ?? {}) as { reps?: number; weight_kg?: number; time_seconds?: number; distance_km?: number };
        const reps = type === "lift" ? (typeof s.reps === "number" ? s.reps : parseInt(String(s.reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof s.weight_kg === "number" ? s.weight_kg : parseFloat(String(s.weight_kg ?? 0)) || null) : null;
        const time_seconds = type === "cardio" ? (typeof s.time_seconds === "number" ? s.time_seconds : parseInt(String(s.time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof s.distance_km === "number" ? s.distance_km : parseFloat(String(s.distance_km ?? 0)) || null) : null;
        if (hasDropIndex) insertSetStmt.run(exerciseId, reps, weight_kg, time_seconds, distance_km, i, 0);
        else insertSetStmt.run(exerciseId, reps, weight_kg, time_seconds, distance_km, i);
      }
    }

    const exercise = db.prepare("SELECT * FROM workout_exercises WHERE id = ?").get(exerciseId) as Record<string, unknown>;
    const setRows = db.prepare(`SELECT * FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? "ORDER BY set_order, drop_index, id" : "ORDER BY set_order"}`).all(exerciseId) as Record<string, unknown>[];
    db.close();

    return NextResponse.json({ ...exercise, sets: setRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add exercise" }, { status: 500 });
  }
}
