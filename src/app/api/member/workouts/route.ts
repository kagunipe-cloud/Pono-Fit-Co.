import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { ensureWorkoutTables } from "../../../../lib/workouts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureWorkoutTables(db);
    const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
    const hasTrainer = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
    const nameCol = hasName ? "w.name," : "";
    const trainerCol = hasTrainer ? "w.assigned_by_trainer_member_id," : "";
    const rows = db
      .prepare(
        `SELECT w.id, w.member_id, w.started_at, w.finished_at, w.assigned_by_admin, ${trainerCol} ${nameCol}
                (SELECT COALESCE(SUM(COALESCE(ws.reps, 0) * COALESCE(ws.weight_kg, 0)), 0)
                 FROM workout_exercises we
                 JOIN workout_sets ws ON ws.workout_exercise_id = we.id
                 WHERE we.workout_id = w.id AND we.type = 'lift') AS total_volume
         FROM workouts w
         WHERE w.member_id = ?
         ORDER BY w.started_at DESC`
      )
      .all(memberId) as { id: number; member_id: string; started_at: string; finished_at: string | null; assigned_by_admin: number; assigned_by_trainer_member_id?: string | null; name?: string | null; total_volume: number }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch workouts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const fromWorkoutId = typeof body.fromWorkoutId === "number" ? body.fromWorkoutId : undefined;

    const db = getDb();
    ensureWorkoutTables(db);

    let sourceWorkoutId: number | null = null;
    if (fromWorkoutId != null) {
      const source = db
        .prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ? AND finished_at IS NOT NULL")
        .get(fromWorkoutId, memberId) as { id: number } | undefined;
      if (!source) {
        db.close();
        return NextResponse.json({ error: "Source workout not found or not finished" }, { status: 400 });
      }
      sourceWorkoutId = source.id;
    }

    const result = db
      .prepare(
        "INSERT INTO workouts (member_id, started_at, finished_at, source_workout_id) VALUES (?, datetime('now'), NULL, ?)"
      )
      .run(memberId, sourceWorkoutId ?? null);
    const id = Number(result.lastInsertRowid);

    if (sourceWorkoutId != null) {
      const weCols = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
      const hasExerciseId = weCols.some((c) => c.name === "exercise_id");
      const hasUseForMy1rm = weCols.some((c) => c.name === "use_for_my_1rm");
      const selectCols = [
        "type",
        "exercise_name",
        "sort_order",
        ...(hasExerciseId ? (["exercise_id"] as const) : []),
        ...(hasUseForMy1rm ? (["use_for_my_1rm"] as const) : []),
      ].join(", ");
      const sourceExercises = db
        .prepare(
          `SELECT ${selectCols} FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id`
        )
        .all(sourceWorkoutId) as {
        type: string;
        exercise_name: string;
        sort_order: number;
        exercise_id?: number | null;
        use_for_my_1rm?: number;
      }[];
      const insertCols = ["workout_id", "type", "exercise_name", "sort_order"];
      const insertVals = "?, ?, ?, ?";
      const placeholders: string[] = [];
      if (hasExerciseId) {
        insertCols.push("exercise_id");
        placeholders.push("?");
      }
      if (hasUseForMy1rm) {
        insertCols.push("use_for_my_1rm");
        placeholders.push("?");
      }
      const insertEx = db.prepare(
        `INSERT INTO workout_exercises (${insertCols.join(", ")}) VALUES (${insertVals}${placeholders.length ? ", " + placeholders.join(", ") : ""})`
      );
      for (const ex of sourceExercises) {
        const args: (string | number | null)[] = [id, ex.type, ex.exercise_name, ex.sort_order];
        if (hasExerciseId) args.push(ex.exercise_id ?? null);
        if (hasUseForMy1rm) args.push(ex.use_for_my_1rm ?? 0);
        insertEx.run(...args);
      }
    }

    const row = db
      .prepare("SELECT id, member_id, started_at, finished_at, source_workout_id FROM workouts WHERE id = ?")
      .get(id) as { id: number; member_id: string; started_at: string; finished_at: string | null; source_workout_id: number | null } | undefined;
    db.close();
    if (!row) return NextResponse.json({ error: "Failed to start workout" }, { status: 500 });
    return NextResponse.json({
      id: row.id,
      member_id: row.member_id,
      started_at: row.started_at,
      finished_at: row.finished_at,
      source_workout_id: row.source_workout_id ?? undefined,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start workout" }, { status: 500 });
  }
}
