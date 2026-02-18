import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** GET a single PT open booking. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const row = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch booking" }, { status: 500 });
  }
}

/** PATCH: update occurrence_date, start_time, member_id, guest_name. If guest_name set, member_id stored as ''. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json();
    const db = getDb();
    ensurePTSlotTables(db);
    const existing = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId) as Record<string, unknown> | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const occurrence_date = body.occurrence_date !== undefined ? String(body.occurrence_date).trim() : existing.occurrence_date;
    const start_time = body.start_time !== undefined ? String(body.start_time).trim() : existing.start_time;
    const guest_name = body.guest_name !== undefined ? (String(body.guest_name).trim() || null) : existing.guest_name;
    const member_id = body.member_id !== undefined ? String(body.member_id).trim() : existing.member_id;
    const effectiveMemberId = guest_name ? "" : (member_id ?? "");
    const effectiveGuestName = guest_name ?? (effectiveMemberId ? null : existing.guest_name);
    db.prepare(
      "UPDATE pt_open_bookings SET occurrence_date = ?, start_time = ?, member_id = ?, guest_name = ? WHERE id = ?"
    ).run(occurrence_date, start_time, effectiveMemberId, effectiveGuestName, numericId);
    const row = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}

/** DELETE. If payment_type was 'credit', restore 1 credit. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const row = db.prepare("SELECT member_id, duration_minutes, payment_type FROM pt_open_bookings WHERE id = ?").get(numericId) as
      | { member_id: string; duration_minutes: number; payment_type: string }
      | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.payment_type === "credit" && row.member_id) {
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_open_booking', ?)"
      ).run(row.member_id, row.duration_minutes, "Credit restored (booking removed)", String(numericId));
    }
    db.prepare("DELETE FROM pt_open_bookings WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
  }
}
