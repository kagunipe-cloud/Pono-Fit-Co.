import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { DEFAULT_PHASE_STEP_PERCENT, parseTrainingPhase, type TrainingPhase } from "@/lib/training-programs";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

function verifyWorkout(
  db: ReturnType<typeof getDb>,
  programId: number,
  workoutId: number,
  editorId: string
): boolean {
  const row = db
    .prepare(
      `SELECT w.id FROM training_program_workouts w
       JOIN training_programs p ON p.id = w.program_id
       WHERE w.id = ? AND w.program_id = ? AND p.creator_member_id = ?`
    )
    .get(workoutId, programId, editorId);
  return !!row;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const editorId = await getProgramEditorMemberId(_req);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const workoutId = parseInt((await params).workoutId, 10);
  if (!Number.isFinite(programId) || !Number.isFinite(workoutId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getDb();
  ensureWorkoutTables(db);
  if (!verifyWorkout(db, programId, workoutId, editorId)) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rules = db
    .prepare(
      `SELECT id, program_workout_id, exercise_key, exercise_id, training_phase,
              target_reps_min, target_reps_max, starting_weight_lb, step_percent
       FROM training_program_progression_rules WHERE program_workout_id = ? ORDER BY exercise_key, training_phase`
    )
    .all(workoutId);

  db.close();
  return NextResponse.json({
    rules,
    defaults_step_percent: DEFAULT_PHASE_STEP_PERCENT,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const workoutId = parseInt((await params).workoutId, 10);
  const body = (await request.json().catch(() => ({}))) as {
    exercise_key?: string;
    exercise_id?: number | null;
    training_phase?: string;
    target_reps_min?: number;
    target_reps_max?: number;
    starting_weight_lb?: number | null;
    step_percent?: number | null;
  };

  const exercise_key = String(body.exercise_key ?? "").trim().toLowerCase();
  if (!exercise_key) return NextResponse.json({ error: "Pick a lift" }, { status: 400 });

  const minR = body.target_reps_min;
  const maxR = body.target_reps_max;
  if (minR == null || maxR == null || minR < 1 || maxR < minR) {
    return NextResponse.json({ error: "Set a valid rep range (min ≤ max, min ≥ 1)" }, { status: 400 });
  }

  const phase = parseTrainingPhase(body.training_phase);

  const db = getDb();
  ensureWorkoutTables(db);
  if (!verifyWorkout(db, programId, workoutId, editorId)) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  db.prepare(
    `INSERT INTO training_program_progression_rules
      (program_workout_id, exercise_key, exercise_id, training_phase, target_reps_min, target_reps_max, starting_weight_lb, step_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(program_workout_id, exercise_key, training_phase) DO UPDATE SET
       exercise_id = excluded.exercise_id,
       target_reps_min = excluded.target_reps_min,
       target_reps_max = excluded.target_reps_max,
       starting_weight_lb = excluded.starting_weight_lb,
       step_percent = excluded.step_percent`
  ).run(
    workoutId,
    exercise_key,
    body.exercise_id ?? null,
    phase,
    minR,
    maxR,
    body.starting_weight_lb ?? null,
    body.step_percent ?? null
  );

  const rule = db
    .prepare(
      `SELECT id, program_workout_id, exercise_key, exercise_id, training_phase,
              target_reps_min, target_reps_max, starting_weight_lb, step_percent
       FROM training_program_progression_rules
       WHERE program_workout_id = ? AND exercise_key = ? AND training_phase = ?`
    )
    .get(workoutId, exercise_key, phase);

  db.close();
  return NextResponse.json({ rule });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const workoutId = parseInt((await params).workoutId, 10);
  const body = (await request.json().catch(() => ({}))) as { exercise_key?: string; training_phase?: string };

  const exercise_key = String(body.exercise_key ?? "").trim().toLowerCase();
  const phase = parseTrainingPhase(body.training_phase);
  if (!exercise_key) return NextResponse.json({ error: "exercise_key required" }, { status: 400 });

  const db = getDb();
  ensureWorkoutTables(db);
  if (!verifyWorkout(db, programId, workoutId, editorId)) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const r = db
    .prepare(
      `DELETE FROM training_program_progression_rules
       WHERE program_workout_id = ? AND exercise_key = ? AND training_phase = ?`
    )
    .run(workoutId, exercise_key, phase);

  db.close();
  return NextResponse.json({ deleted: r.changes > 0 });
}