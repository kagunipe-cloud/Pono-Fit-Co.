import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId, getTrainerMemberId } from "../../../../../lib/admin";
import { ensureTrainerClientsTable } from "../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/**
 * PATCH { notes? } — update client row. Allowed if current user is admin or the trainer who owns this client.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  const trainerId = await getTrainerMemberId(request);
  if (!adminId && !trainerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const notes = body.notes != null ? String(body.notes) : undefined;

  const db = getDb();
  ensureTrainerClientsTable(db);
  const row = db.prepare("SELECT id, trainer_member_id FROM trainer_clients WHERE id = ?").get(id) as { id: number; trainer_member_id: string } | undefined;
  if (!row) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = !!adminId;
  if (!isAdmin && row.trainer_member_id !== trainerId) {
    db.close();
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (notes !== undefined) {
    db.prepare("UPDATE trainer_clients SET notes = ? WHERE id = ?").run(notes, id);
  }
  const updated = db.prepare("SELECT * FROM trainer_clients WHERE id = ?").get(id);
  db.close();
  return NextResponse.json(updated);
}

/**
 * DELETE — remove client. Allowed if current user is admin or the trainer who owns this client.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  const trainerId = await getTrainerMemberId(request);
  if (!adminId && !trainerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);
  const row = db.prepare("SELECT id, trainer_member_id FROM trainer_clients WHERE id = ?").get(id) as { id: number; trainer_member_id: string } | undefined;
  if (!row) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = !!adminId;
  if (!isAdmin && row.trainer_member_id !== trainerId) {
    db.close();
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  db.prepare("DELETE FROM trainer_clients WHERE id = ?").run(id);
  db.close();
  return NextResponse.json({ ok: true });
}
