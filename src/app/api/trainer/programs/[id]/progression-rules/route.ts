import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { parseTrainingPhase } from "@/lib/training-programs";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/** POST — upsert progression rule for a lift on a program workout + phase. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const body = (await request.json().catch(() => ({}))) as {
    program_workout_id?: number;
    exercise_key?: string;
    exercise_id?: number | null;
    training_phase?: string;
    target_reps_min?: number;
    target_reps_max?: number;
    starting_weight_lb?: number;
    step_percent?: number | null;
  };

  const db = getDb();
  ensureWorkoutTables(db);
  const program = db
    .prepare("SELECT id FROM training_programs WHERE id = ? AND creator_member_id = ?")
    .get(programId, editorId);
  if (!program) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pwId = body.program_workout_id;
  if (!pwId) {
    db.close();
    return NextResponse.json({ error: "program_workout_id required" }, { status: 400 });
  }
  const owned = db
    .prepare("SELECT id FROM training_program_workouts WHERE id = ? AND program_id = ?")
    .get(pwId, programId);
  if (!owned) {
    db.close();
    return NextResponse.json({ error: "Workout not in program" }, { status: 400 });
  }

  const exercise_key = String(body.exercise_key ?? "").trim().toLowerCase();
  if (!exercise_key) {
    db.close();
    return NextResponse.json({ error: "exercise_key required" }, { status: 400 });
  }

  const phase = parseTrainingPhase(body.training_phase);
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
    pwId,
    exercise_key,
    body.exercise_id ?? null,
    phase,
    body.target_reps_min ?? null,
    body.target_reps_max ?? null,
    body.starting_weight_lb ?? null,
    body.step_percent ?? null
  );

  db.close();
  return NextResponse.json({ ok: true });
}