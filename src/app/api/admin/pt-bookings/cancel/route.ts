import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

/** POST { type: "slot", id: number } | { type: "block", id: number } — Admin only. Cancels the PT booking; block bookings get credit restored. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const type = (body.type ?? "").trim();
    const id = parseInt(String(body.id), 10);
    if (!["slot", "block"].includes(type) || Number.isNaN(id)) {
      return NextResponse.json({ error: "type must be 'slot' or 'block', and id must be a number" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);

    if (type === "slot") {
      const row = db.prepare("SELECT id, pt_session_id, member_id FROM pt_slot_bookings WHERE id = ?").get(id) as { id: number; pt_session_id: number; member_id: string } | undefined;
      if (!row) {
        db.close();
        return NextResponse.json({ error: "PT slot booking not found" }, { status: 404 });
      }
      const session = db.prepare("SELECT duration_minutes FROM pt_sessions WHERE id = ?").get(row.pt_session_id) as { duration_minutes: number } | undefined;
      db.prepare("DELETE FROM pt_slot_bookings WHERE id = ?").run(id);
      if (session?.duration_minutes) {
        db.prepare(
          "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_slot', ?)"
        ).run(row.member_id, session.duration_minutes, "Credit restored (admin cancelled booking)", String(id));
      }
    } else {
      const row = db.prepare("SELECT id, member_id, session_duration_minutes FROM pt_block_bookings WHERE id = ?").get(id) as { id: number; member_id: string; session_duration_minutes: number } | undefined;
      if (!row) {
        db.close();
        return NextResponse.json({ error: "PT block booking not found" }, { status: 404 });
      }
      db.prepare("DELETE FROM pt_block_bookings WHERE id = ?").run(id);
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_block', ?)"
      ).run(row.member_id, row.session_duration_minutes, "Credit restored (admin cancelled booking)", String(id));
    }
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel PT booking" }, { status: 500 });
  }
}
