import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import {
  mergeProgramProgressIntoExercises,
  parseProgramTemplateJson,
  parseTrainingPhase,
} from "@/lib/training-programs";
import { populateTrainerAssignedWorkoutContent, type TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/** Start a program workout — creates member workout pre-filled from template + progression weights. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; workoutId: string }> }) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const assignmentId = parseInt((await params).id, 10);
  const programWorkoutId = parseInt((await params).workoutId, 10);
  if (!Number.isFinite(assignmentId) || !Number.isFinite(programWorkoutId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getDb();
  ensureWorkoutTables(db);

  const assignment = db
    .prepare(
      `SELECT a.id, a.program_id, p.title
       FROM member_program_assignments a
       JOIN training_programs p ON p.id = a.program_id
       WHERE a.id = ? AND a.member_id = ? AND a.status = 'active'`
    )
    .get(assignmentId, memberId) as { id: number; program_id: number; title: string } | undefined;
  if (!assignment) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pw = db
    .prepare("SELECT * FROM training_program_workouts WHERE id = ? AND program_id = ?")
    .get(programWorkoutId, assignment.program_id) as {
    id: number;
    name: string;
    training_phase: string;
    template_json: string;
  } | undefined;
  if (!pw) {
    db.close();
    return NextResponse.json({ error: "Workout not in program" }, { status: 404 });
  }

  const phase = parseTrainingPhase(pw.training_phase);
  const exercises = parseProgramTemplateJson(pw.template_json);
  const progressRows = db
    .prepare(
      "SELECT exercise_key, current_weight_lb, extra_reps_per_set FROM member_program_lift_progress WHERE assignment_id = ? AND training_phase = ?"
    )
    .all(assignmentId, phase) as { exercise_key: string; current_weight_lb: number; extra_reps_per_set: number }[];

  const rules = db
    .prepare(
      "SELECT exercise_key, starting_weight_lb FROM training_program_progression_rules WHERE program_workout_id = ? AND training_phase = ?"
    )
    .all(programWorkoutId, phase) as { exercise_key: string; starting_weight_lb: number | null }[];

  const mergedExercises = mergeProgramProgressIntoExercises(exercises, progressRows, rules);

  const open = db
    .prepare("SELECT id FROM workouts WHERE member_id = ? AND finished_at IS NULL LIMIT 1")
    .get(memberId) as { id: number } | undefined;
  if (open) {
    db.close();
    return NextResponse.json({ error: "Finish or discard your open workout first", open_workout_id: open.id }, { status: 409 });
  }

  const wCols = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  const hasProgramCols =
    wCols.some((c) => c.name === "program_assignment_id") && wCols.some((c) => c.name === "program_workout_id");

  let workoutId: number;
  if (hasProgramCols) {
    const r = db
      .prepare(
        `INSERT INTO workouts (member_id, name, program_assignment_id, program_workout_id, program_title)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(memberId, pw.name, assignmentId, programWorkoutId, assignment.title);
    workoutId = Number(r.lastInsertRowid);
  } else {
    const r = db.prepare("INSERT INTO workouts (member_id, name) VALUES (?, ?)").run(memberId, pw.name);
    workoutId = Number(r.lastInsertRowid);
  }

  populateTrainerAssignedWorkoutContent(db, workoutId, memberId, mergedExercises);
  db.close();

  return NextResponse.json({ workout_id: workoutId });
}