import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersProfileColumns } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getAdminMemberId, getTrainerMemberId } from "../../../../lib/admin";
import { ensurePTSlotTables, getPTCreditBalance, normalizePtDurationMinutes, reservedMinutes } from "../../../../lib/pt-slots";
import { ensureTrainerClient } from "../../../../lib/trainer-clients";
import {
  getFreeIntervals,
  getBlocksInRange,
  getContiguousAvailabilityChain,
  getBookingsForBlocks,
  getUnavailableInRange,
  getUnavailableRangesForBlock,
} from "../../../../lib/pt-availability";
import { timeToMinutes, minutesToTime } from "../../../../lib/pt-slots";
import {
  sendStaffEmail,
  sendMemberEmail,
  sendMemberBookingConfirmationEmail,
  getTrainerDisplayNameFromMemberId,
} from "../../../../lib/email";
import { memberSameDayPtBookingError } from "../../../../lib/same-day-scheduling";
import { memberPtBookingPhoneError } from "../../../../lib/member-phone";
import { memberFirstTimePtDurationError, firstTimeStackTwoThirtyCreditsError, FIRST_TIME_PT_MIN_DURATION_MINUTES } from "../../../../lib/first-time-pt-booking";

export const dynamic = "force-dynamic";

/**
 * POST { trainer_availability_id, occurrence_date, start_time, session_duration_minutes, member_id, use_credit?, pay_on_arrival? }
 * Books a PT session within trainer availability. Reserves 45/75/120 min (or exact if only that much left).
 * pay_on_arrival: admin only — books without payment or credit; member pays when they arrive.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const trainer_availability_id = parseInt(String(body.trainer_availability_id), 10);
    const occurrence_date = (body.occurrence_date ?? "").trim();
    const start_time = (body.start_time ?? "").trim();
    const requested_duration_minutes = normalizePtDurationMinutes(body.session_duration_minutes, 60);
    const member_id = (body.member_id ?? "").trim();
    const use_credit = !!body.use_credit;
    const pay_on_arrival = !!body.pay_on_arrival;
    const first_time_stack_30_credits = !!body.first_time_stack_30_credits;
    let session_duration_minutes = requested_duration_minutes;

    if (!trainer_availability_id || !occurrence_date || !start_time || !member_id) {
      return NextResponse.json({ error: "trainer_availability_id, occurrence_date, start_time, member_id required" }, { status: 400 });
    }

    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    const trainerActorId = await getTrainerMemberId(request);
    const blockRowEarly = (() => {
      const dbEarly = getDb();
      ensurePTSlotTables(dbEarly);
      const b = dbEarly.prepare("SELECT trainer_member_id FROM trainer_availability WHERE id = ?").get(trainer_availability_id) as
        | { trainer_member_id: string | null }
        | undefined;
      dbEarly.close();
      return b;
    })();
    const trainerBookingForMember =
      !!trainerActorId &&
      !!blockRowEarly &&
      (blockRowEarly.trainer_member_id ?? "").trim() === trainerActorId.trim() &&
      sessionMemberId !== member_id;

    if (sessionMemberId !== member_id && !isAdmin && !trainerBookingForMember) {
      return NextResponse.json({ error: "Forbidden: can only book for yourself unless admin or this trainer" }, { status: 403 });
    }
    if (pay_on_arrival && !isAdmin) {
      return NextResponse.json({ error: "Only admins can book pay-on-arrival" }, { status: 403 });
    }
    if (first_time_stack_30_credits) {
      if (!use_credit || pay_on_arrival) {
        return NextResponse.json({ error: "Stacked first-visit credits require using PT credits." }, { status: 400 });
      }
      if (requested_duration_minutes !== 30) {
        return NextResponse.json({ error: "Stacked first-visit credits require a 30-minute session type." }, { status: 400 });
      }
      session_duration_minutes = FIRST_TIME_PT_MIN_DURATION_MINUTES;
    }

    const db = getDb();
    ensurePTSlotTables(db);
    ensureMembersProfileColumns(db);

    const tz = getAppTimezone(db);
    const memberSelfBooking = sessionMemberId === member_id && !isAdmin && !trainerBookingForMember;
    const sameDayErr = memberSameDayPtBookingError(occurrence_date, tz, { isAdmin, memberSelfBooking });
    if (sameDayErr) {
      db.close();
      return NextResponse.json({ error: sameDayErr }, { status: 400 });
    }

    const phoneErr = memberPtBookingPhoneError(db, member_id, { isAdmin, memberSelfBooking });
    if (phoneErr) {
      db.close();
      return NextResponse.json({ error: phoneErr }, { status: 400 });
    }

    const firstTimeDurationErr = memberFirstTimePtDurationError(db, member_id, requested_duration_minutes, {
      isAdmin,
      memberSelfBooking,
      stackTwoThirtyCredits: first_time_stack_30_credits,
    });
    if (firstTimeDurationErr) {
      db.close();
      return NextResponse.json({ error: firstTimeDurationErr }, { status: 400 });
    }

    if (first_time_stack_30_credits) {
      const stackErr = firstTimeStackTwoThirtyCreditsError(db, member_id, requested_duration_minutes, {
        isAdmin,
        memberSelfBooking,
      });
      if (stackErr) {
        db.close();
        return NextResponse.json({ error: stackErr }, { status: 400 });
      }
    }

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
      return NextResponse.json({ error: "Start time is outside this trainer availability block" }, { status: 400 });
    }

    const dayBlocks = getBlocksInRange(occurrence_date, occurrence_date);
    const chain = getContiguousAvailabilityChain(dayBlocks, trainer_availability_id);
    const mergedStartMin = chain?.mergedStartMin ?? blockStart;
    const mergedEndMin = chain?.mergedEndMin ?? blockEnd;
    const chainBlockIds = chain?.blockIds ?? [trainer_availability_id];

    const bookings = getBookingsForBlocks(db, chainBlockIds, occurrence_date);
    const unavailOccurrences = getUnavailableInRange(occurrence_date, occurrence_date);
    const unavailRanges = getUnavailableRangesForBlock(
      { trainer: block.trainer, start_time: minutesToTime(mergedStartMin), end_time: minutesToTime(mergedEndMin) },
      occurrence_date,
      unavailOccurrences
    );
    const free = getFreeIntervals(mergedStartMin, mergedEndMin, bookings, unavailRanges);
    const interval = free.find((iv) => startMin >= iv.startMin && startMin < iv.endMin);
    if (!interval) {
      db.close();
      return NextResponse.json({ error: "This start time is no longer available" }, { status: 409 });
    }

    const remainingMinutes = interval.endMin - startMin;
    /** Must match INSERT below: 30→45, 60→75, 90→120 unless the free tail exactly equals session length. */
    const reserved_minutes = reservedMinutes(session_duration_minutes, remainingMinutes);
    if (remainingMinutes < reserved_minutes) {
      db.close();
      return NextResponse.json(
        {
          error: `This slot does not have enough contiguous time for a ${session_duration_minutes}-min session. The schedule reserves ${reserved_minutes} minutes (including turnover), but only ${remainingMinutes} minutes are free here before the next booking, end of this trainer window, or a hold. Try an earlier time, a shorter session type, or use "Add to cart" to create an open booking (confirmed at payment) instead of locking this trainer block.`,
        },
        { status: 400 }
      );
    }

    if (use_credit && !pay_on_arrival) {
      if (first_time_stack_30_credits) {
        const balance30 = getPTCreditBalance(db, member_id, requested_duration_minutes);
        if (balance30 < 2) {
          db.close();
          return NextResponse.json({ error: "You need two 30-minute PT credits for a stacked first visit." }, { status: 400 });
        }
        db.prepare(
          "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'trainer_specific_booking', ?)"
        ).run(
          member_id,
          requested_duration_minutes,
          "First visit stacked 30-min credit (1 of 2)",
          String(trainer_availability_id + "-" + occurrence_date + "-" + start_time + "-stack1")
        );
        db.prepare(
          "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'trainer_specific_booking', ?)"
        ).run(
          member_id,
          requested_duration_minutes,
          "First visit stacked 30-min credit (2 of 2)",
          String(trainer_availability_id + "-" + occurrence_date + "-" + start_time + "-stack2")
        );
      } else {
        const balance = getPTCreditBalance(db, member_id, session_duration_minutes);
        if (balance < 1) {
          db.close();
          return NextResponse.json({ error: `No ${session_duration_minutes}-min PT credits. Purchase a pack or pay.` }, { status: 400 });
        }
        db.prepare(
          "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'trainer_specific_booking', ?)"
        ).run(member_id, session_duration_minutes, `Booked ${session_duration_minutes}-min PT`, String(trainer_availability_id + "-" + occurrence_date + "-" + start_time));
      }
    }

    const payment_type = pay_on_arrival ? "pay_on_arrival" : use_credit ? "credit" : "paid";
    db.prepare(
      "INSERT INTO pt_trainer_specific_bookings (trainer_availability_id, occurrence_date, start_time, session_duration_minutes, reserved_minutes, member_id, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(trainer_availability_id, occurrence_date, start_time, session_duration_minutes, reserved_minutes, member_id, payment_type);

    const trainerMemberId = (block.trainer_member_id ?? "").trim();
    if (trainerMemberId) ensureTrainerClient(db, trainerMemberId, member_id);

    const newBalance =
      use_credit && !pay_on_arrival
        ? getPTCreditBalance(db, member_id, first_time_stack_30_credits ? requested_duration_minutes : session_duration_minutes)
        : undefined;

    // Email notifications: staff + trainer
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || member_id : member_id;
      const whenStr = `${occurrence_date} ${start_time}`;
      const sessionLabel = first_time_stack_30_credits
        ? `${session_duration_minutes} min first PT (2×30-min credits)`
        : `${session_duration_minutes} min`;
      const staffSubject = `PT booking: ${memberName} → ${block.trainer}`;
      const staffBody = `${memberName} booked PT (${sessionLabel}) with ${block.trainer} on ${whenStr}.`;
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      const trainerId = (block.trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db
          .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
          .get(trainerId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          const trainerSubject = `New PT booking with ${memberName}`;
          const trainerBody = `${memberName} booked a ${sessionLabel} PT session with you on ${whenStr}.`;
          sendMemberEmail(trainerEmail, trainerSubject, trainerBody).catch(() => {});
        }
      }

      const memberEmail = memberRow?.email?.trim();
      if (memberEmail) {
        const tz = getAppTimezone(db);
        const trainerDisplay =
          (block.trainer ?? "").trim() || getTrainerDisplayNameFromMemberId(db, block.trainer_member_id);
        sendMemberBookingConfirmationEmail({
          to: memberEmail,
          memberFirstName: memberRow?.first_name,
          kind: "pt",
          sessionTitle: `${sessionLabel} PT with ${block.trainer}`,
          dateYmd: occurrence_date,
          timeRaw: start_time,
          trainerDisplayName: trainerDisplay,
          timeZone: tz,
        }).catch(() => {});
      }
    } catch {
      // ignore email errors
    }

    db.close();
    return NextResponse.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to book PT" }, { status: 500 });
  }
}
