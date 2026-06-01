import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrainerMemberId } from "@/lib/admin";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/** POST { client_member_id }. Trainer/admin only. Opens an empty workout on the client's account for live logging. */
export async function POST(request: NextRequest) {
  const trainerId = await getTrainerMemberId(request);
  if (!trainerId) {
    return NextResponse.json({ error: "Trainer or admin only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const client_member_id = (body.client_member_id ?? "").toString().trim();
    if (!client_member_id) {
      return NextResponse.json({ error: "client_member_id required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const member = db
      .prepare("SELECT member_id FROM members WHERE member_id = ? LIMIT 1")
      .get(client_member_id) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const isAdmin = db.prepare("SELECT 1 FROM members WHERE member_id = ? AND role = 'Admin'").get(trainerId);
    const canAssign =
      isAdmin ||
      db
        .prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?")
        .get(trainerId, client_member_id);
    if (!canAssign) {
      db.close();
      return NextResponse.json({ error: "You can only record workouts for your own clients" }, { status: 403 });
    }

    const open = db
      .prepare("SELECT id FROM workouts WHERE member_id = ? AND finished_at IS NULL LIMIT 1")
      .get(client_member_id) as { id: number } | undefined;
    if (open) {
      db.close();
      return NextResponse.json(
        {
          error: "This member already has a workout in progress.",
          workout_id: open.id,
        },
        { status: 409 }
      );
    }

    const hasTrainerCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some(
      (c) => c.name === "assigned_by_trainer_member_id"
    );
    if (!hasTrainerCol) {
      db.close();
      return NextResponse.json({ error: "Schema missing assigned_by_trainer_member_id" }, { status: 500 });
    }

    const workoutResult = db
      .prepare(
        "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, assigned_by_trainer_member_id) VALUES (?, datetime('now'), NULL, 0, ?)"
      )
      .run(member.member_id, trainerId);
    const workoutId = Number(workoutResult.lastInsertRowid);

    const row = db
      .prepare("SELECT id, member_id, started_at, finished_at FROM workouts WHERE id = ?")
      .get(workoutId) as {
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
      message: "Workout opened on the client's account. Log exercises and finish when done — it will appear on their history as a completed session.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start workout for client" }, { status: 500 });
  }
}
