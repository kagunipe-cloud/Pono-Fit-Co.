import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrainerMemberId } from "@/lib/admin";
import { ensureWorkoutTables } from "@/lib/workouts-server";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";
import { populateTrainerAssignedWorkoutContent } from "@/lib/trainer-assigned-workout-content";
import { applyMemberWorkoutFinishSideEffects } from "@/lib/workout-finish-side-effects";

export const dynamic = "force-dynamic";

/** POST { client_member_id, exercises, trainer_notes?, save_as_completed?: boolean }. Trainer only. Default: unfinished assignment for client to complete. If save_as_completed is true, workout is stored as finished so it appears on their history immediately (e.g. after an in-person session). */
export async function POST(request: NextRequest) {
  const trainerId = await getTrainerMemberId(request);
  if (!trainerId) {
    return NextResponse.json({ error: "Trainer only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const client_member_id = (body.client_member_id ?? "").toString().trim();
    const exercises = Array.isArray(body.exercises) ? body.exercises : [];
    const trainer_notes = typeof body.trainer_notes === "string" ? body.trainer_notes.trim() || null : null;
    const save_as_completed = body.save_as_completed === true;

    if (!client_member_id) {
      return NextResponse.json({ error: "client_member_id required" }, { status: 400 });
    }

    const db = getDb();
    const member = db.prepare("SELECT member_id FROM members WHERE member_id = ? LIMIT 1").get(client_member_id) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const isAdmin = db.prepare("SELECT 1 FROM members WHERE member_id = ? AND role = 'Admin'").get(trainerId);
    const canAssign = isAdmin || db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, client_member_id);
    if (!canAssign) {
      db.close();
      return NextResponse.json({ error: "You can only create workouts for your own clients" }, { status: 403 });
    }

    ensureWorkoutTables(db);

    const hasTrainerCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
    if (!hasTrainerCol) {
      db.close();
      return NextResponse.json({ error: "Schema missing assigned_by_trainer_member_id" }, { status: 500 });
    }

    const workoutResult = save_as_completed
      ? db
          .prepare(
            "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, assigned_by_trainer_member_id, trainer_notes) VALUES (?, datetime('now'), datetime('now'), 0, ?, ?)"
          )
          .run(member.member_id, trainerId, trainer_notes)
      : db
          .prepare(
            "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, assigned_by_trainer_member_id, trainer_notes) VALUES (?, datetime('now'), NULL, 0, ?, ?)"
          )
          .run(member.member_id, trainerId, trainer_notes);
    const workoutId = Number(workoutResult.lastInsertRowid);

    populateTrainerAssignedWorkoutContent(db, workoutId, member.member_id, exercises as TrainerAssignedExercisePayload[]);

    if (save_as_completed) {
      applyMemberWorkoutFinishSideEffects(db, workoutId, member.member_id);
    }

    const row = db.prepare("SELECT id, member_id, started_at, finished_at FROM workouts WHERE id = ?").get(workoutId) as {
      id: number;
      member_id: string;
      started_at: string;
      finished_at: string | null;
    };
    db.close();

    return NextResponse.json({
      id: row.id,
      member_id: row.member_id,
      started_at: row.started_at,
      finished_at: row.finished_at,
      message: save_as_completed
        ? "Workout saved as completed on the client’s history. They’ll see it in their workout list."
        : "Workout sent to client. They can open it under Workouts from my trainer, fill in sets/reps/weight, and finish to send results back.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create workout for client" }, { status: 500 });
  }
}
