import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { ensurePTSlotTables, reservedMinutes } from "../../../../lib/pt-slots";
import { ensureTrainerClient } from "../../../../lib/trainer-clients";
import { getBlocksInRange, getBookingsForBlock, getFreeIntervals } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";
import { sendMemberEmail } from "../../../../lib/email";

export const dynamic = "force-dynamic";

/**
 * POST { open_booking_id: number, trainer_member_id: string }
 * Converts an open booking to a trainer-specific booking when the trainer has
 * an availability block at that date/time. Moves the booking from pt_open_bookings to
 * pt_trainer_specific_bookings. Does not change credits (already used for the open booking).
 * Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const open_booking_id = parseInt(String(body.open_booking_id), 10);
    const trainer_member_id = (body.trainer_member_id ?? "").trim();

    if (Number.isNaN(open_booking_id) || !trainer_member_id) {
      return NextResponse.json({ error: "open_booking_id and trainer_member_id required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    const open = db.prepare(
      "SELECT id, member_id, guest_name, occurrence_date, start_time, duration_minutes, payment_type FROM pt_open_bookings WHERE id = ?"
    ).get(open_booking_id) as
      | { id: number; member_id: string; guest_name: string | null; occurrence_date: string; start_time: string; duration_minutes: number; payment_type: string }
      | undefined;

    if (!open) {
      db.close();
      return NextResponse.json({ error: "Open booking not found" }, { status: 404 });
    }

    const member_id = (open.member_id ?? "").trim();
    if (!member_id || open.guest_name) {
      db.close();
      return NextResponse.json({ error: "Cannot convert guest bookings to trainer-specific. Assign trainer on the open booking instead." }, { status: 400 });
    }

    const blocks = getBlocksInRange(open.occurrence_date, open.occurrence_date);
    const startMin = timeToMinutes(open.start_time);
    const block = blocks.find((b) => {
      if ((b.trainer_member_id ?? "").trim() !== trainer_member_id) return false;
      const blockStart = timeToMinutes(b.start_time);
      const blockEnd = timeToMinutes(b.end_time);
      return startMin >= blockStart && startMin < blockEnd;
    });

    if (!block) {
      db.close();
      return NextResponse.json({ error: "Trainer has no availability block at this date/time" }, { status: 404 });
    }

    const bookings = getBookingsForBlock(db, block.id, open.occurrence_date);
    const free = getFreeIntervals(timeToMinutes(block.start_time), timeToMinutes(block.end_time), bookings);
    const interval = free.find((iv) => startMin >= iv.startMin && startMin < iv.endMin);
    if (!interval) {
      db.close();
      return NextResponse.json({ error: "This slot is no longer available in the trainer's block" }, { status: 409 });
    }

    const remainingMinutes = interval.endMin - startMin;
    const session_duration_minutes = [30, 60, 90].includes(open.duration_minutes) ? open.duration_minutes : 60;
    if (remainingMinutes < session_duration_minutes) {
      db.close();
      return NextResponse.json({ error: "Not enough time left in the trainer's block for this duration" }, { status: 400 });
    }

    const reserved_minutes = reservedMinutes(session_duration_minutes, remainingMinutes);
    const payment_type = open.payment_type || "paid";

    db.prepare(
      "INSERT INTO pt_trainer_specific_bookings (trainer_availability_id, occurrence_date, start_time, session_duration_minutes, reserved_minutes, member_id, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(block.id, open.occurrence_date, open.start_time, session_duration_minutes, reserved_minutes, member_id, payment_type);

    ensureTrainerClient(db, trainer_member_id, member_id);

    // Update credit ledger so it references the new trainer-specific booking (full conversion)
    if (payment_type === "credit") {
      const blockRef = `${block.id}-${open.occurrence_date}-${open.start_time}`;
      db.prepare(
        "UPDATE pt_credit_ledger SET reference_type = 'trainer_specific_booking', reference_id = ? WHERE reference_type = 'pt_open_booking' AND reference_id = ?"
      ).run(blockRef, `open:${open_booking_id}`);
    }

    db.prepare("DELETE FROM pt_open_bookings WHERE id = ?").run(open_booking_id);

    try {
      const memberRow = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(member_id) as { first_name: string | null; last_name: string | null } | undefined;
      const trainerRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(trainer_member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || "A client" : "A client";
      const trainerEmail = trainerRow?.email?.trim();
      if (trainerEmail) {
        const subject = `PT session assigned: ${memberName} — ${open.occurrence_date} at ${open.start_time}`;
        const text = `You've been assigned a PT session with ${memberName} on ${open.occurrence_date} at ${open.start_time}.`;
        sendMemberEmail(trainerEmail, subject, text).catch(() => {});
      }
    } catch {
      /* ignore email errors */
    }

    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to convert booking" }, { status: 500 });
  }
}
