import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalance, reservedMinutes } from "../../../../lib/pt-slots";
import { getBlocksInRange, getFreeIntervals, getBookingsForBlock } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";
import { sendStaffEmail, sendMemberEmail } from "../../../../lib/email";

export const dynamic = "force-dynamic";

/**
 * POST { trainer_availability_id, occurrence_date, start_time, session_duration_minutes (30|60|90), member_id, use_credit? }
 * Books a PT session within trainer availability. Reserves 45/75/120 min (or exact if only that much left).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const trainer_availability_id = parseInt(String(body.trainer_availability_id), 10);
    const occurrence_date = (body.occurrence_date ?? "").trim();
    const start_time = (body.start_time ?? "").trim();
    const session_duration_minutes = [30, 60, 90].includes(Number(body.session_duration_minutes))
      ? Number(body.session_duration_minutes)
      : 60;
    const member_id = (body.member_id ?? "").trim();
    const use_credit = !!body.use_credit;

    if (!trainer_availability_id || !occurrence_date || !start_time || !member_id) {
      return NextResponse.json({ error: "trainer_availability_id, occurrence_date, start_time, member_id required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    const block = db.prepare("SELECT id, trainer, trainer_member_id, start_time, end_time FROM trainer_availability WHERE id = ?").get(trainer_availability_id) as
      | { id: number; trainer: string; trainer_member_id: string | null; start_time: string; end_time: string }
      | undefined;
    if (!block) {
      db.close();
      return NextResponse.json({ error: "Availability block not found" }, { status: 404 });
    }

    const blockStart = timeToMinutes(block.start_time);
    const blockEnd = timeToMinutes(block.end_time);
    const startMin = timeToMinutes(start_time);
    if (startMin < blockStart || startMin >= blockEnd) {
      db.close();
      return NextResponse.json({ error: "Start time is outside this availability block" }, { status: 400 });
    }

    const bookings = getBookingsForBlock(db, trainer_availability_id, occurrence_date);
    const free = getFreeIntervals(blockStart, blockEnd, bookings);
    const interval = free.find((iv) => startMin >= iv.startMin && startMin < iv.endMin);
    if (!interval) {
      db.close();
      return NextResponse.json({ error: "This start time is no longer available" }, { status: 409 });
    }

    const remainingMinutes = interval.endMin - startMin;
    if (remainingMinutes < session_duration_minutes) {
      db.close();
      return NextResponse.json({ error: "Not enough time left in this block for the chosen duration" }, { status: 400 });
    }

    const reserved_minutes = reservedMinutes(session_duration_minutes, remainingMinutes);

    if (use_credit) {
      const balance = getPTCreditBalance(db, member_id, session_duration_minutes);
      if (balance < 1) {
        db.close();
        return NextResponse.json({ error: `No ${session_duration_minutes}-min PT credits. Purchase a pack or pay.` }, { status: 400 });
      }
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_block_booking', ?)"
      ).run(member_id, session_duration_minutes, `Booked ${session_duration_minutes}-min PT`, String(trainer_availability_id + "-" + occurrence_date + "-" + start_time));
    }

    db.prepare(
      "INSERT INTO pt_block_bookings (trainer_availability_id, occurrence_date, start_time, session_duration_minutes, reserved_minutes, member_id, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(trainer_availability_id, occurrence_date, start_time, session_duration_minutes, reserved_minutes, member_id, use_credit ? "credit" : "paid");

    const newBalance = use_credit ? getPTCreditBalance(db, member_id, session_duration_minutes) : undefined;

    // Email notifications: staff + trainer
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || member_id : member_id;
      const whenStr = `${occurrence_date} ${start_time}`;
      const staffSubject = `PT booking: ${memberName} → ${block.trainer}`;
      const staffBody = `${memberName} booked PT (${session_duration_minutes} min) with ${block.trainer} on ${whenStr}.`;
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      const trainerId = (block.trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db
          .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
          .get(trainerId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          const trainerSubject = `New PT booking with ${memberName}`;
          const trainerBody = `${memberName} booked a ${session_duration_minutes}-minute PT session with you on ${whenStr}.`;
          sendMemberEmail(trainerEmail, trainerSubject, trainerBody).catch(() => {});
        }
      }
    } catch {
      // ignore email errors
    }

    db.close();
    return NextResponse.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to book PT block" }, { status: 500 });
  }
}
