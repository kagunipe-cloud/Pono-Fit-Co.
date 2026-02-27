import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { getTrainerMemberId, getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

function canModifyBlock(memberId: string | null, isAdmin: boolean, blockTrainerMemberId: string | null): boolean {
  if (isAdmin) return true;
  if (!memberId) return false;
  return blockTrainerMemberId === memberId;
}

/** PATCH — update an availability block (only if current user owns it or is admin). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getTrainerMemberId(request);
    const isAdmin = !!(await getAdminMemberId(request));
    if (!memberId && !isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    const block = db.prepare("SELECT id, trainer_member_id FROM trainer_availability WHERE id = ?").get(numericId) as { id: number; trainer_member_id: string | null } | undefined;
    if (!block) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyBlock(memberId, isAdmin, block.trainer_member_id)) {
      db.close();
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.day_of_week !== undefined) { updates.push("day_of_week = ?"); values.push(Math.max(0, Math.min(6, parseInt(String(body.day_of_week), 10) || 0))); }
    if (body.start_time !== undefined) { updates.push("start_time = ?"); values.push(String(body.start_time).trim()); }
    if (body.end_time !== undefined) { updates.push("end_time = ?"); values.push(String(body.end_time).trim()); }
    if (body.description !== undefined) { updates.push("description = ?"); values.push((String(body.description).trim() || null) as string); }
    if (body.days_of_week !== undefined) { updates.push("days_of_week = ?"); values.push((String(body.days_of_week).trim() || null) as string); }
    if (updates.length === 0) {
      db.close();
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    values.push(numericId);
    db.prepare(`UPDATE trainer_availability SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(numericId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update availability" }, { status: 500 });
  }
}

/** DELETE — remove an availability block (only if current user owns it or is admin). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getTrainerMemberId();
    const isAdmin = !!(await getAdminMemberId());
    if (!memberId && !isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    const block = db.prepare("SELECT id, trainer_member_id FROM trainer_availability WHERE id = ?").get(numericId) as { id: number; trainer_member_id: string | null } | undefined;
    if (!block) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyBlock(memberId, isAdmin, block.trainer_member_id)) {
      db.close();
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    db.prepare("DELETE FROM pt_block_bookings WHERE trainer_availability_id = ?").run(numericId);
    db.prepare("DELETE FROM trainer_availability WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete availability" }, { status: 500 });
  }
}
