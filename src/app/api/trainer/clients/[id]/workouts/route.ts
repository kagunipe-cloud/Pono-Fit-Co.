import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getTrainerMemberId, getAdminMemberId } from "../../../../../../lib/admin";
import { ensureWorkoutTables } from "../../../../../../lib/workouts";
import { ensureTrainerClientsTable } from "../../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/** GET — Workouts assigned to this client by the current trainer (or any trainer if admin). Returns full workout with exercises and sets for display on client PT dashboard. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const trainerId = await getTrainerMemberId(_request);
  const adminId = await getAdminMemberId(_request);
  if (!trainerId && !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientMemberId = (await params).id?.trim();
  if (!clientMemberId) {
    return NextResponse.json({ error: "Client id required" }, { status: 400 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);
  const isAdmin = !!adminId;
  if (!isAdmin) {
    const link = db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, clientMemberId);
    if (!link) {
      db.close();
      return NextResponse.json({ error: "You can only view your own clients" }, { status: 403 });
    }
  }

  ensureWorkoutTables(db);

  const hasTrainerCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "assigned_by_trainer_member_id");
  if (!hasTrainerCol) {
    db.close();
    return NextResponse.json({ workouts: [] });
  }

  const trainerFilter = isAdmin ? "" : "AND w.assigned_by_trainer_member_id = ?";
  const args = isAdmin ? [clientMemberId] : [clientMemberId, trainerId];
  const hasNotesCols = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "trainer_notes");
  const notesCols = hasNotesCols ? ", w.trainer_notes, w.client_completion_notes" : "";
  const rows = db.prepare(
    `SELECT w.id, w.started_at, w.finished_at, w.assigned_by_trainer_member_id${notesCols}
     FROM workouts w
     WHERE w.member_id = ? AND w.assigned_by_trainer_member_id IS NOT NULL ${trainerFilter}
     ORDER BY w.started_at DESC`
  ).all(...args) as { id: number; started_at: string; finished_at: string | null; assigned_by_trainer_member_id: string; trainer_notes?: string | null; client_completion_notes?: string | null }[];

  const workouts: { id: number; started_at: string; finished_at: string | null; trainer_notes?: string | null; client_completion_notes?: string | null; exercises: { exercise_name: string; type: string; sets: { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null }[] }[] }[] = [];

  for (const w of rows) {
    const exercises = db.prepare(
      "SELECT id, type, exercise_name FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id"
    ).all(w.id) as { id: number; type: string; exercise_name: string }[];
    const exWithSets = exercises.map((ex) => {
      const sets = db.prepare(
        "SELECT reps, weight_kg, time_seconds, distance_km FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id"
      ).all(ex.id) as { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null }[];
      return { exercise_name: ex.exercise_name, type: ex.type, sets };
    });
    workouts.push({
      id: w.id,
      started_at: w.started_at,
      finished_at: w.finished_at,
      ...(hasNotesCols && { trainer_notes: w.trainer_notes, client_completion_notes: w.client_completion_notes }),
      exercises: exWithSets,
    });
  }

  db.close();
  return NextResponse.json({ workouts });
}
