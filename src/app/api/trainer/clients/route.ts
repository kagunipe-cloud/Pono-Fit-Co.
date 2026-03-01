import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId, getTrainerMemberId } from "../../../../lib/admin";
import { ensureTrainerClientsTable } from "../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/**
 * GET ?trainer_member_id= (optional)
 * - Admin, no param: all PT clients with trainer name.
 * - Admin, trainer_member_id: that trainer's clients.
 * - Trainer: own clients only (param ignored).
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  const trainerId = await getTrainerMemberId(request);
  if (!adminId && !trainerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterTrainerId = searchParams.get("trainer_member_id")?.trim() || null;

  const db = getDb();
  ensureTrainerClientsTable(db);

  const isAdmin = !!adminId;
  const effectiveTrainerId = isAdmin && filterTrainerId ? filterTrainerId : trainerId;
  if (!effectiveTrainerId && !isAdmin) {
    db.close();
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  type Row = { id: number; trainer_member_id: string; client_member_id: string; notes: string | null; created_at: string | null };
  let rows: Row[];

  if (isAdmin && !filterTrainerId) {
    rows = db.prepare(
      `SELECT tc.id, tc.trainer_member_id, tc.client_member_id, tc.notes, tc.created_at
       FROM trainer_clients tc
       ORDER BY tc.trainer_member_id, tc.client_member_id`
    ).all() as Row[];
  } else {
    rows = db.prepare(
      `SELECT id, trainer_member_id, client_member_id, notes, created_at
       FROM trainer_clients
       WHERE trainer_member_id = ?
       ORDER BY client_member_id`
    ).all(effectiveTrainerId!) as Row[];
  }

  const memberIds = new Set<string>();
  rows.forEach((r) => {
    memberIds.add(r.trainer_member_id);
    memberIds.add(r.client_member_id);
  });
  const members = memberIds.size > 0
    ? (db.prepare(
        `SELECT member_id, first_name, last_name, email FROM members WHERE member_id IN (${[...memberIds].map(() => "?").join(",")})`
      ).all(...[...memberIds]) as { member_id: string; first_name: string | null; last_name: string | null; email: string | null }[])
    : [];
  const memberMap = new Map(members.map((m) => [m.member_id, m]));

  const out = rows.map((r) => {
    const trainer = memberMap.get(r.trainer_member_id);
    const client = memberMap.get(r.client_member_id);
    const trainerName = trainer ? [trainer.first_name, trainer.last_name].filter(Boolean).join(" ").trim() || r.trainer_member_id : r.trainer_member_id;
    const clientName = client ? [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || r.client_member_id : r.client_member_id;
    return {
      id: r.id,
      trainer_member_id: r.trainer_member_id,
      client_member_id: r.client_member_id,
      notes: r.notes,
      created_at: r.created_at,
      trainer_name: trainerName,
      client_name: clientName,
      client_email: client?.email ?? null,
    };
  });

  db.close();
  return NextResponse.json(out);
}

/**
 * POST { trainer_member_id? (optional; admin only), client_member_id }
 * Trainer can only add to own list (omit trainer_member_id). Admin can set trainer_member_id.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  const trainerId = await getTrainerMemberId(request);
  if (!adminId && !trainerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientMemberId = (body.client_member_id ?? "").trim();
  const trainerMemberIdParam = (body.trainer_member_id ?? "").trim() || null;

  if (!clientMemberId) {
    return NextResponse.json({ error: "client_member_id required" }, { status: 400 });
  }

  const isAdmin = !!adminId;
  const effectiveTrainerId = isAdmin && trainerMemberIdParam ? trainerMemberIdParam : trainerId;
  if (!effectiveTrainerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);

  const member = db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(clientMemberId);
  if (!member) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  try {
    db.prepare(
      "INSERT INTO trainer_clients (trainer_member_id, client_member_id) VALUES (?, ?)"
    ).run(effectiveTrainerId, clientMemberId);
  } catch (e) {
    db.close();
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return NextResponse.json({ error: "Client already in list" }, { status: 409 });
    }
    throw e;
  }
  const row = db.prepare("SELECT * FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(effectiveTrainerId, clientMemberId);
  db.close();
  return NextResponse.json(row);
}
