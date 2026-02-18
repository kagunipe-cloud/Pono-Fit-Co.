import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalance } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/**
 * POST { pt_session_id: number, member_id: string, use_credit: boolean }
 * Books a PT slot. If use_credit, deducts 1 credit for that duration and creates pt_slot_booking.
 * If !use_credit, returns instruction to add to cart / pay (caller can add pt_session to cart).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pt_session_id = parseInt(String(body.pt_session_id), 10);
    const member_id = (body.member_id ?? "").trim();
    const use_credit = !!body.use_credit;

    if (!pt_session_id || Number.isNaN(pt_session_id) || !member_id) {
      return NextResponse.json({ error: "pt_session_id and member_id required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    const session = db.prepare("SELECT id, duration_minutes, price FROM pt_sessions WHERE id = ?").get(pt_session_id) as
      | { id: number; duration_minutes: number | null; price: string | null }
      | undefined;
    if (!session) {
      db.close();
      return NextResponse.json({ error: "PT session not found" }, { status: 404 });
    }

    const existing = db.prepare("SELECT id FROM pt_slot_bookings WHERE pt_session_id = ?").get(pt_session_id);
    if (existing) {
      db.close();
      return NextResponse.json({ error: "This slot is already booked" }, { status: 409 });
    }

    const duration = session.duration_minutes ?? 60;
    if (![30, 60, 90].includes(duration)) {
      db.close();
      return NextResponse.json({ error: "Invalid session duration" }, { status: 400 });
    }

    if (use_credit) {
      const balance = getPTCreditBalance(db, member_id, duration);
      if (balance < 1) {
        db.close();
        return NextResponse.json({ error: `No ${duration}-min PT credits. Purchase a pack or pay for this slot.` }, { status: 400 });
      }
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_slot_booking', ?)"
      ).run(member_id, duration, `Booked ${duration}-min PT slot`, String(pt_session_id));
      db.prepare(
        "INSERT INTO pt_slot_bookings (pt_session_id, member_id, payment_type) VALUES (?, ?, 'credit')"
      ).run(pt_session_id, member_id);
      const newBalance = getPTCreditBalance(db, member_id, duration);
      db.close();
      return NextResponse.json({ ok: true, balance: newBalance, balances: { [duration]: newBalance } });
    }

    db.close();
    return NextResponse.json({ ok: false, use_cart: true, message: "Add this session to cart to pay." });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to book PT slot" }, { status: 500 });
  }
}
