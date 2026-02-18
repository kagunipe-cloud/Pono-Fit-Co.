import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

type LiftPart = { reps?: number | null; weight_kg?: number | null };
type CardioPart = { time_seconds?: number | null; distance_km?: number | null };

/** Normalize sets to grouped format: lift can be [ [part, part?, part?], ... ] (dropsets) or flat [ part, ... ]. Cardio stays flat. */
function normalizeSetGroups(
  sets: unknown[],
  type: "lift" | "cardio"
): (LiftPart[] | CardioPart[])[] {
  if (sets.length === 0) return [];
  const isGrouped = type === "lift" && Array.isArray(sets[0]);
  if (isGrouped) {
    return (sets as (LiftPart | CardioPart)[]).map((g) => (Array.isArray(g) ? g : [g]) as LiftPart[] | CardioPart[]);
  }
  return (sets as (LiftPart | CardioPart)[]).map((s) => [s]) as (LiftPart[] | CardioPart[])[];
}

const setSelectCols = "id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index";
const setOrderBy = "ORDER BY set_order, drop_index, id";

/** POST body: { sets: [ { reps?, weight_kg? } ] or grouped [ [part, part?, part?], ... ] for lift; same for cardio (no drops). Appends sets. */
export async function POST(
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
    const sets = Array.isArray(body.sets) ? body.sets : [];

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const exercise = db
      .prepare("SELECT id, type FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number; type: string } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const type = exercise.type === "cardio" ? "cardio" : "lift";
    const maxOrder = db.prepare(
      "SELECT COALESCE(MAX(set_order), -1) AS m FROM workout_sets WHERE workout_exercise_id = ?"
    ).get(exId) as { m: number };
    let setOrder = (maxOrder?.m ?? -1) + 1;

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const insertSet = hasDropIndex
      ? db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
      : db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
        );

    const groups = normalizeSetGroups(sets, type);
    for (const group of groups) {
      for (let dropIndex = 0; dropIndex < group.length; dropIndex++) {
        const s = group[dropIndex] ?? {};
        const reps = type === "lift" ? (typeof (s as LiftPart).reps === "number" ? (s as LiftPart).reps : parseInt(String((s as LiftPart).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as LiftPart).weight_kg === "number" ? (s as LiftPart).weight_kg : parseFloat(String((s as LiftPart).weight_kg ?? 0)) || null) : null;
        const time_seconds = type === "cardio" ? (typeof (s as CardioPart).time_seconds === "number" ? (s as CardioPart).time_seconds : parseInt(String((s as CardioPart).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as CardioPart).distance_km === "number" ? (s as CardioPart).distance_km : parseFloat(String((s as CardioPart).distance_km ?? 0)) || null) : null;
        if (hasDropIndex) insertSet.run([exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex]);
        else insertSet.run([exId, reps, weight_kg, time_seconds, distance_km, setOrder]);
      }
      setOrder++;
    }

    const setRows = db
      .prepare(`SELECT ${hasDropIndex ? setSelectCols : "id, reps, weight_kg, time_seconds, distance_km, set_order"} FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`)
      .all(exId) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
    db.close();

    return NextResponse.json({ sets: setRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add sets" }, { status: 500 });
  }
}

/** PUT body: { sets: flat or grouped (same as POST). Replaces all sets. */
export async function PUT(
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
    const sets = Array.isArray(body.sets) ? body.sets : [];

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const exercise = db
      .prepare("SELECT id, type FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number; type: string } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const type = exercise.type === "cardio" ? "cardio" : "lift";
    db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ?").run(exId);

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const insertSet = hasDropIndex
      ? db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
      : db.prepare(
          "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
        );

    const groups = normalizeSetGroups(sets, type);
    for (let setOrder = 0; setOrder < groups.length; setOrder++) {
      const group = groups[setOrder] ?? [];
      for (let dropIndex = 0; dropIndex < group.length; dropIndex++) {
        const s = group[dropIndex] ?? {};
        const reps = type === "lift" ? (typeof (s as LiftPart).reps === "number" ? (s as LiftPart).reps : parseInt(String((s as LiftPart).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as LiftPart).weight_kg === "number" ? (s as LiftPart).weight_kg : parseFloat(String((s as LiftPart).weight_kg ?? 0)) || null) : null;
        const time_seconds = type === "cardio" ? (typeof (s as CardioPart).time_seconds === "number" ? (s as CardioPart).time_seconds : parseInt(String((s as CardioPart).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as CardioPart).distance_km === "number" ? (s as CardioPart).distance_km : parseFloat(String((s as CardioPart).distance_km ?? 0)) || null) : null;
        if (hasDropIndex) insertSet.run([exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex]);
        else insertSet.run([exId, reps, weight_kg, time_seconds, distance_km, setOrder]);
      }
    }

    const setRows = db
      .prepare(`SELECT ${hasDropIndex ? setSelectCols : "id, reps, weight_kg, time_seconds, distance_km, set_order"} FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`)
      .all(exId) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
    db.close();

    return NextResponse.json({ sets: setRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to replace sets" }, { status: 500 });
  }
}
