import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { assignmentProgramStartYmd, scheduledDateForProgramDay } from "@/lib/program-schedule";
import { parseProgramTemplateJson, parseTrainingPhase } from "@/lib/training-programs";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const assignmentId = parseInt((await params).id, 10);
  if (!Number.isFinite(assignmentId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getDb();
  ensureWorkoutTables(db);
  const a = db
    .prepare(
      `SELECT a.*, p.title, p.description
       FROM member_program_assignments a
       JOIN training_programs p ON p.id = a.program_id
       WHERE a.id = ? AND a.member_id = ?`
    )
    .get(assignmentId, memberId) as {
    program_id: number;
    title: string;
    description: string | null;
    starts_on: string | null;
    created_at: string;
  } | undefined;
  if (!a) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const workouts = db
    .prepare(
      `SELECT id, day_index, sort_order, name, training_phase, template_json
       FROM training_program_workouts WHERE program_id = ? ORDER BY day_index, sort_order, id`
    )
    .all(a.program_id) as {
    id: number;
    day_index: number;
    sort_order: number;
    name: string;
    training_phase: string;
    template_json: string;
  }[];

  const progress = db
    .prepare("SELECT exercise_key, training_phase, current_weight_lb FROM member_program_lift_progress WHERE assignment_id = ?")
    .all(assignmentId);

  const programStart = assignmentProgramStartYmd(a.starts_on, a.created_at);

  db.close();

  return NextResponse.json({
    assignment: { ...a, program_start: programStart },
    workouts: workouts.map((w) => ({
      ...w,
      training_phase: parseTrainingPhase(w.training_phase),
      exercise_count: parseProgramTemplateJson(w.template_json).length,
      scheduled_date: scheduledDateForProgramDay(programStart, w.day_index),
    })),
    lift_progress: progress,
  });
}