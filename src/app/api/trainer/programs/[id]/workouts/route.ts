import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { parseTrainingPhase } from "@/lib/training-programs";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  if (!Number.isFinite(programId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    day_index?: number;
    training_phase?: string;
    exercises?: TrainerAssignedExercisePayload[];
    copy_from_workout_id?: number;
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

  let exercises = Array.isArray(body.exercises) ? body.exercises : [];
  const copyId = body.copy_from_workout_id;
  if (copyId && exercises.length === 0) {
    const src = db
      .prepare("SELECT template_json, name, training_phase FROM training_program_workouts WHERE id = ? AND program_id = ?")
      .get(copyId, programId) as { template_json: string; name: string; training_phase: string } | undefined;
    if (src) {
      try {
        exercises = JSON.parse(src.template_json) as TrainerAssignedExercisePayload[];
      } catch {
        exercises = [];
      }
    }
  }

  const dayIndex = Math.max(1, typeof body.day_index === "number" ? body.day_index : 1);
  const name = String(body.name ?? "Workout").trim() || "Workout";
  const sort = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM training_program_workouts WHERE program_id = ? AND day_index = ?")
    .get(programId, dayIndex) as { n: number };

  const r = db
    .prepare(
      `INSERT INTO training_program_workouts (program_id, day_index, sort_order, name, training_phase, template_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(programId, dayIndex, sort.n, name, parseTrainingPhase(body.training_phase), JSON.stringify(exercises));

  db.prepare("UPDATE training_programs SET updated_at = datetime('now') WHERE id = ?").run(programId);
  const row = db.prepare("SELECT * FROM training_program_workouts WHERE id = ?").get(r.lastInsertRowid);
  db.close();
  return NextResponse.json({ workout: row });
}