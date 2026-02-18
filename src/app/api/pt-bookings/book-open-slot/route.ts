import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalance } from "../../../../lib/pt-slots";
import { hasClassAtSlot } from "../../../../lib/schedule-conflicts";
import { getUnavailableInRange } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

const SLOT_MINUTES = 30;

const PT_BUFFER_MINUTES = 15;

/** Check if [startMin, startMin+durationMinutes] is free. No overlap with any block. PT buffer: nothing may start in (ourEnd, ourEnd+15]; OK if something starts exactly when we end. */
function isOpenSlotFree(
  db: ReturnType<typeof getDb>,
  date: string,
  startMin: number,
  durationMinutes: number
): boolean {
  const endMin = startMin + durationMinutes;
  for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
    if (hasClassAtSlot(db, date, m)) return false;
  }
  const unavail = getUnavailableInRange(date, date);
  for (const u of unavail) {
    if (u.date !== date) continue;
    const uStart = timeToMinutes(u.start_time);
    const uEnd = timeToMinutes(u.end_time);
    if (startMin < uEnd && endMin > uStart) return false;
  }
  const openBookings = db
    .prepare("SELECT occurrence_date, start_time, duration_minutes FROM pt_open_bookings WHERE occurrence_date = ?")
    .all(date) as { occurrence_date: string; start_time: string; duration_minutes: number }[];
  for (const b of openBookings) {
    const bStart = timeToMinutes(b.start_time);
    const bEnd = bStart + b.duration_minutes;
    if (startMin < bEnd && endMin > bStart) return false;
    if (bStart > endMin && bStart <= endMin + PT_BUFFER_MINUTES) return false;
  }
  const blockBookings = db
    .prepare(
      `SELECT start_time, reserved_minutes FROM pt_block_bookings WHERE occurrence_date = ?`
    )
    .all(date) as { start_time: string; reserved_minutes: number }[];
  for (const b of blockBookings) {
    const bStart = timeToMinutes(b.start_time);
    const bEnd = bStart + b.reserved_minutes;
    if (startMin < bEnd && endMin > bStart) return false;
  }
  return true;
}

/**
 * POST { member_id, occurrence_date, start_time, duration_minutes (30|60|90), pt_session_id }
 * Books an "open" slot (from schedule). Uses 1 PT credit. pt_session_id must be a product (date_time IS NULL).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const occurrence_date = (body.occurrence_date ?? "").trim();
    const start_time = (body.start_time ?? "").trim();
    const duration_minutes = [30, 60, 90].includes(Number(body.duration_minutes)) ? Number(body.duration_minutes) : 60;
    const pt_session_id = parseInt(String(body.pt_session_id), 10);

    if (!member_id || !occurrence_date || !start_time || Number.isNaN(pt_session_id)) {
      return NextResponse.json({ error: "member_id, occurrence_date, start_time, pt_session_id required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    const session = db.prepare("SELECT id, duration_minutes, date_time FROM pt_sessions WHERE id = ?").get(pt_session_id) as
      | { id: number; duration_minutes: number; date_time: string | null }
      | undefined;
    if (!session || session.date_time != null) {
      db.close();
      return NextResponse.json({ error: "PT session product not found (must be a bookable product without date/time)" }, { status: 404 });
    }
    if (session.duration_minutes !== duration_minutes) {
      db.close();
      return NextResponse.json({ error: "Session duration does not match chosen duration" }, { status: 400 });
    }

    const startMin = timeToMinutes(start_time);
    if (!isOpenSlotFree(db, occurrence_date, startMin, duration_minutes)) {
      db.close();
      return NextResponse.json({ error: "There is a schedule conflict. Please select a time slot with enough time for the duration of your session." }, { status: 409 });
    }

    const balance = getPTCreditBalance(db, member_id, duration_minutes);
    if (balance < 1) {
      db.close();
      return NextResponse.json({ error: `No ${duration_minutes}-min PT credits. Purchase a pack or add to cart.` }, { status: 400 });
    }

    db.prepare(
      "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_open_booking', ?)"
    ).run(member_id, duration_minutes, `Booked ${duration_minutes}-min PT`, String(pt_session_id));

    db.prepare(
      "INSERT INTO pt_open_bookings (member_id, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type) VALUES (?, ?, ?, ?, ?, 'credit')"
    ).run(member_id, occurrence_date, start_time, duration_minutes, pt_session_id);

    const newBalance = getPTCreditBalance(db, member_id, duration_minutes);
    db.close();
    return NextResponse.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to book PT slot" }, { status: 500 });
  }
}
