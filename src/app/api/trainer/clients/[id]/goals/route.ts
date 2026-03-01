import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getTrainerMemberId, getAdminMemberId } from "../../../../../../lib/admin";
import { ensureClientGoalsTable } from "../../../../../../lib/client-goals";
import { ensureTrainerClientsTable } from "../../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

type GoalsRow = {
  client_member_id: string;
  goal_weight: number | null;
  goal_body_fat: number | null;
  goal_muscle_gain: number | null;
  updated_at: string | null;
};

/** GET — Current goals for this client. */
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

  ensureClientGoalsTable(db);
  const row = db.prepare(
    "SELECT * FROM client_goals WHERE client_member_id = ?"
  ).get(clientMemberId) as GoalsRow | undefined;

  db.close();
  if (!row) {
    return NextResponse.json({ goals: null });
  }
  return NextResponse.json({
    goals: {
      goal_weight: row.goal_weight,
      goal_body_fat: row.goal_body_fat,
      goal_muscle_gain: row.goal_muscle_gain,
      updated_at: row.updated_at,
    },
  });
}

/** PATCH — Set or clear goals. Body: { goal_weight?, goal_body_fat?, goal_muscle_gain? } (null to clear). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const trainerId = await getTrainerMemberId(request);
  const adminId = await getAdminMemberId(request);
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
      return NextResponse.json({ error: "You can only update goals for your own clients" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
  const goal_weight = num(body.goal_weight);
  const goal_body_fat = num(body.goal_body_fat);
  const goal_muscle_gain = num(body.goal_muscle_gain);

  ensureClientGoalsTable(db);
  db.prepare(`
    INSERT INTO client_goals (client_member_id, goal_weight, goal_body_fat, goal_muscle_gain, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_member_id) DO UPDATE SET
      goal_weight = excluded.goal_weight,
      goal_body_fat = excluded.goal_body_fat,
      goal_muscle_gain = excluded.goal_muscle_gain,
      updated_at = datetime('now')
  `).run(clientMemberId, goal_weight, goal_body_fat, goal_muscle_gain);

  const row = db.prepare("SELECT * FROM client_goals WHERE client_member_id = ?").get(clientMemberId) as GoalsRow;
  db.close();

  return NextResponse.json({
    goals: {
      goal_weight: row.goal_weight,
      goal_body_fat: row.goal_body_fat,
      goal_muscle_gain: row.goal_muscle_gain,
      updated_at: row.updated_at,
    },
  });
}
