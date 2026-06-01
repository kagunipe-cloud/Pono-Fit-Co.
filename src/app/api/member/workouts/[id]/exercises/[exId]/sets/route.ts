import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { isTimedExerciseType, parseExerciseType, type ExerciseType } from "@/lib/exercise-types";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";
import { normalizeWorkoutNote } from "@/lib/workout-notes";
import { getWorkoutOwnerForSession } from "@/lib/member-workout-access";

export const dynamic = "force-dynamic";

type LiftPart = { reps?: number | null; weight_kg?: number | null; notes?: unknown };
type CardioPart = { time_seconds?: number | null; distance_km?: number | null; notes?: unknown };

/** Normalize sets to grouped format: lift can be [ [part, part?, part?], ... ] (dropsets) or flat [ part, ... ]. Cardio stays flat. */
function normalizeSetGroups(
  sets: unknown[],
  type: ExerciseType
): (LiftPart[] | CardioPart[])[] {
  if (sets.length === 0) return [];
  const isGrouped = type === "lift" && Array.isArray(sets[0]);
  if (isGrouped) {
    return (sets as (LiftPart | CardioPart)[]).map((g) => (Array.isArray(g) ? g : [g]) as LiftPart[] | CardioPart[]);
  }
  return (sets as (LiftPart | CardioPart)[]).map((s) => [s]) as (LiftPart[] | CardioPart[])[];
}

const setOrderBy = "ORDER BY set_order, drop_index, id";

function setSelectColsForTable(hasDropIndex: boolean, hasSetNotes: boolean): string {
  let c = "id, reps, weight_kg, time_seconds, distance_km, set_order";
  if (hasDropIndex) c += ", drop_index";
  if (hasSetNotes) c += ", notes";
  return c;
}

/** POST body: { sets: [ { reps?, weight_kg? } ] or grouped [ [part, part?, part?], ... ] for lift; same for cardio (no drops). Appends sets. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  try {
    const sessionMemberId = await getMemberIdFromSession();

    const workoutId = parseInt((await params).id, 10);
    const exId = parseInt((await params).exId, 10);
    if (Number.isNaN(workoutId) || Number.isNaN(exId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const sets = Array.isArray(body.sets) ? body.sets : [];

    const db = getDb();
    ensureWorkoutTables(db);

    const access = getWorkoutOwnerForSession(sessionMemberId, workoutId, db);
    if (!access.ok) {
      db.close();
      return access.response;
    }

    const exercise = db
      .prepare("SELECT id, type FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number; type: string } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const type = parseExerciseType(exercise.type);
    const maxOrder = db.prepare(
      "SELECT COALESCE(MAX(set_order), -1) AS m FROM workout_sets WHERE workout_exercise_id = ?"
    ).get(exId) as { m: number };
    let setOrder = (maxOrder?.m ?? -1) + 1;

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const hasSetNotes = tableCols.includes("notes");
    let insertSet: Database.Statement<unknown[]>;
    if (hasDropIndex && hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasDropIndex) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
      );
    }

    const groups = normalizeSetGroups(sets, type);
    for (const group of groups) {
      for (let dropIndex = 0; dropIndex < group.length; dropIndex++) {
        const s = group[dropIndex] ?? {};
        const reps = type === "lift" ? (typeof (s as LiftPart).reps === "number" ? (s as LiftPart).reps : parseInt(String((s as LiftPart).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as LiftPart).weight_kg === "number" ? (s as LiftPart).weight_kg : parseFloat(String((s as LiftPart).weight_kg ?? 0)) || null) : null;
        const time_seconds = isTimedExerciseType(type) ? (typeof (s as CardioPart).time_seconds === "number" ? (s as CardioPart).time_seconds : parseInt(String((s as CardioPart).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as CardioPart).distance_km === "number" ? (s as CardioPart).distance_km : parseFloat(String((s as CardioPart).distance_km ?? 0)) || null) : null;
        const notes = normalizeWorkoutNote((s as LiftPart & CardioPart).notes);
        if (hasDropIndex && hasSetNotes) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex, notes);
        else if (hasDropIndex) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex);
        else if (hasSetNotes) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, notes);
        else insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder);
      }
      setOrder++;
    }

    const selCols = setSelectColsForTable(hasDropIndex, hasSetNotes);
    const setRows = db
      .prepare(`SELECT ${selCols} FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`)
      .all(exId) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number; notes?: string | null }[];
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
    const sessionMemberId = await getMemberIdFromSession();

    const workoutId = parseInt((await params).id, 10);
    const exId = parseInt((await params).exId, 10);
    if (Number.isNaN(workoutId) || Number.isNaN(exId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const sets = Array.isArray(body.sets) ? body.sets : [];

    const db = getDb();
    ensureWorkoutTables(db);

    const access = getWorkoutOwnerForSession(sessionMemberId, workoutId, db);
    if (!access.ok) {
      db.close();
      return access.response;
    }

    const exercise = db
      .prepare("SELECT id, type FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number; type: string } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const type = parseExerciseType(exercise.type);
    db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ?").run(exId);

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const hasSetNotes = tableCols.includes("notes");
    let insertSet: Database.Statement<unknown[]>;
    if (hasDropIndex && hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasDropIndex) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
      );
    }

    const groups = normalizeSetGroups(sets, type);
    for (let setOrder = 0; setOrder < groups.length; setOrder++) {
      const group = groups[setOrder] ?? [];
      for (let dropIndex = 0; dropIndex < group.length; dropIndex++) {
        const s = group[dropIndex] ?? {};
        const reps = type === "lift" ? (typeof (s as LiftPart).reps === "number" ? (s as LiftPart).reps : parseInt(String((s as LiftPart).reps ?? 0), 10) || null) : null;
        const weight_kg = type === "lift" ? (typeof (s as LiftPart).weight_kg === "number" ? (s as LiftPart).weight_kg : parseFloat(String((s as LiftPart).weight_kg ?? 0)) || null) : null;
        const time_seconds = isTimedExerciseType(type) ? (typeof (s as CardioPart).time_seconds === "number" ? (s as CardioPart).time_seconds : parseInt(String((s as CardioPart).time_seconds ?? 0), 10) || null) : null;
        const distance_km = type === "cardio" ? (typeof (s as CardioPart).distance_km === "number" ? (s as CardioPart).distance_km : parseFloat(String((s as CardioPart).distance_km ?? 0)) || null) : null;
        const notes = normalizeWorkoutNote((s as LiftPart & CardioPart).notes);
        if (hasDropIndex && hasSetNotes) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex, notes);
        else if (hasDropIndex) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, dropIndex);
        else if (hasSetNotes) insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder, notes);
        else insertSet.run(exId, reps, weight_kg, time_seconds, distance_km, setOrder);
      }
    }

    const selColsPut = setSelectColsForTable(hasDropIndex, hasSetNotes);
    const setRows = db
      .prepare(`SELECT ${selColsPut} FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`)
      .all(exId) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number; notes?: string | null }[];
    db.close();

    return NextResponse.json({ sets: setRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to replace sets" }, { status: 500 });
  }
}

/**
 * DELETE ?set_order=N — remove all rows for that set (including drop-set parts), then renumber remaining sets to 0..n-1.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  try {
    const sessionMemberId = await getMemberIdFromSession();

    const workoutId = parseInt((await params).id, 10);
    const exId = parseInt((await params).exId, 10);
    if (Number.isNaN(workoutId) || Number.isNaN(exId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const setOrderParam = request.nextUrl.searchParams.get("set_order");
    if (setOrderParam == null || setOrderParam === "")
      return NextResponse.json({ error: "set_order query parameter required" }, { status: 400 });
    const targetOrder = parseInt(setOrderParam, 10);
    if (Number.isNaN(targetOrder)) return NextResponse.json({ error: "Invalid set_order" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);

    const access = getWorkoutOwnerForSession(sessionMemberId, workoutId, db);
    if (!access.ok) {
      db.close();
      return access.response;
    }

    const exercise = db
      .prepare("SELECT id FROM workout_exercises WHERE id = ? AND workout_id = ?")
      .get(exId, workoutId) as { id: number } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const tableCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = tableCols.includes("drop_index");
    const hasSetNotes = tableCols.includes("notes");

    const before = db
      .prepare(`SELECT id, set_order FROM workout_sets WHERE workout_exercise_id = ? AND set_order = ?`)
      .all(exId, targetOrder) as { id: number; set_order: number }[];
    if (before.length === 0) {
      db.close();
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }

    db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ? AND set_order = ?").run(exId, targetOrder);

    const remaining = db
      .prepare(
        `SELECT id, set_order FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`
      )
      .all(exId) as { id: number; set_order: number }[];

    if (remaining.length > 0) {
      const byOldOrder = new Map<number, { id: number }[]>();
      for (const r of remaining) {
        if (!byOldOrder.has(r.set_order)) byOldOrder.set(r.set_order, []);
        byOldOrder.get(r.set_order)!.push({ id: r.id });
      }
      const sortedOld = [...byOldOrder.keys()].sort((a, b) => a - b);
      const updateStmt = db.prepare("UPDATE workout_sets SET set_order = ? WHERE id = ?");
      for (let ni = 0; ni < sortedOld.length; ni++) {
        const oldO = sortedOld[ni];
        for (const row of byOldOrder.get(oldO)!) {
          updateStmt.run(ni, row.id);
        }
      }
    }

    const selColsDel = setSelectColsForTable(hasDropIndex, hasSetNotes);
    const setRows = db
      .prepare(`SELECT ${selColsDel} FROM workout_sets WHERE workout_exercise_id = ? ${hasDropIndex ? setOrderBy : "ORDER BY set_order, id"}`)
      .all(exId) as { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number; notes?: string | null }[];
    db.close();

    return NextResponse.json({ sets: setRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete set" }, { status: 500 });
  }
}
