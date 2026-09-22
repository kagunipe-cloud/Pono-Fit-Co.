import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersProfileColumns } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getAdminMemberId } from "../../../../lib/admin";
import { ensurePTSlotTables, getPTCreditBalance, normalizePtDurationMinutes } from "../../../../lib/pt-slots";
import { isPTBookingSlotFree } from "../../../../lib/schedule-conflicts";
import { timeToMinutes } from "../../../../lib/pt-slots";
import {
  sendStaffEmail,
  sendMemberEmail,
  sendMemberBookingConfirmationEmail,
  getTrainerDisplayNameFromMemberId,
} from "../../../../lib/email";
import { ensureTrainerClient, getTrainerMemberIdByDisplayName } from "../../../../lib/trainer-clients";
import { memberSameDayPtBookingError } from "../../../../lib/same-day-scheduling";
import { memberPtBookingPhoneError } from "../../../../lib/member-phone";
import { memberFirstTimePtDurationError, firstTimeStackTwoThirtyCreditsError, FIRST_TIME_PT_MIN_DURATION_MINUTES } from "../../../../lib/first-time-pt-booking";

function trainerDisplayForOpen(
  db: ReturnType<typeof getDb>,
  trainerMemberId: string | null,
  trainerDisplayFromSession: string | null
): string | null {
  const fromMember = getTrainerDisplayNameFromMemberId(db, trainerMemberId);
  if (fromMember) return fromMember;
  const t = (trainerDisplayFromSession ?? "").trim();
  return t || null;
}

export const dynamic = "force-dynamic";

/**
 * POST { member_id, occurrence_date, start_time, duration_minutes (must match session), pt_session_id, pay_on_arrival? }
 * Books an "open" slot (from schedule). Uses 1 PT credit unless pay_on_arrival (admin only).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const occurrence_date = (body.occurrence_date ?? "").trim();
    const start_time = (body.start_time ?? "").trim();
    const duration_minutes = normalizePtDurationMinutes(body.duration_minutes, 60);
    const pt_session_id = parseInt(String(body.pt_session_id), 10);
    const pay_on_arrival = !!body.pay_on_arrival;
    const first_time_stack_30_credits = !!body.first_time_stack_30_credits;

    if (!member_id || !occurrence_date || !start_time || Number.isNaN(pt_session_id)) {
      return NextResponse.json({ error: "member_id, occurrence_date, start_time, pt_session_id required" }, { status: 400 });
    }

    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    if (sessionMemberId !== member_id && !isAdmin) {
      return NextResponse.json({ error: "Forbidden: can only book for yourself unless admin" }, { status: 403 });
    }
    if (pay_on_arrival && !isAdmin) {
      return NextResponse.json({ error: "Only admins can book pay-on-arrival" }, { status: 403 });
    }
    if (first_time_stack_30_credits && pay_on_arrival) {
      return NextResponse.json({ error: "Stacked first-visit credits require using PT credits." }, { status: 400 });
    }

    const tz = getAppTimezone();
    const memberSelfBooking = sessionMemberId === member_id && !isAdmin;
    const sameDayErr = memberSameDayPtBookingError(occurrence_date, tz, { isAdmin, memberSelfBooking });
    if (sameDayErr) {
      return NextResponse.json({ error: sameDayErr }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    ensureMembersProfileColumns(db);

    const phoneErr = memberPtBookingPhoneError(db, member_id, { isAdmin, memberSelfBooking });
    if (phoneErr) {
      db.close();
      return NextResponse.json({ error: phoneErr }, { status: 400 });
    }

    const firstTimeDurationErr = memberFirstTimePtDurationError(db, member_id, duration_minutes, {
      isAdmin,
      memberSelfBooking,
      stackTwoThirtyCredits: first_time_stack_30_credits,
    });
    if (firstTimeDurationErr) {
      db.close();
      return NextResponse.json({ error: firstTimeDurationErr }, { status: 400 });
    }

    const session = db.prepare("SELECT id, duration_minutes, date_time, trainer, session_name FROM pt_sessions WHERE id = ?").get(pt_session_id) as
      | { id: number; duration_minutes: number; date_time: string | null; trainer: string | null; session_name: string | null }
      | undefined;
    if (!session || session.date_time != null) {
      db.close();
      return NextResponse.json({ error: "PT session product not found (must be a bookable product without date/time)" }, { status: 404 });
    }

    if (first_time_stack_30_credits) {
      const stackErr = firstTimeStackTwoThirtyCreditsError(db, member_id, session.duration_minutes, {
        isAdmin,
        memberSelfBooking,
      });
      if (stackErr) {
        db.close();
        return NextResponse.json({ error: stackErr }, { status: 400 });
      }
    } else if (session.duration_minutes !== duration_minutes) {
      db.close();
      return NextResponse.json({ error: "Session duration does not match chosen duration" }, { status: 400 });
    }

    const scheduleDurationMinutes = first_time_stack_30_credits
      ? FIRST_TIME_PT_MIN_DURATION_MINUTES
      : duration_minutes;

    const startMin = timeToMinutes(start_time);
    const trainerMemberId = session.trainer ? getTrainerMemberIdByDisplayName(db, session.trainer) : null;
    if (!isPTBookingSlotFree(db, occurrence_date, startMin, scheduleDurationMinutes, trainerMemberId)) {
      db.close();
      return NextResponse.json({ error: "There is a schedule conflict. Please select a time slot with enough time for the duration of your session." }, { status: 409 });
    }

    if (!pay_on_arrival) {
      if (first_time_stack_30_credits) {
        const balance30 = getPTCreditBalance(db, member_id, session.duration_minutes);
        if (balance30 < 2) {
          db.close();
          return NextResponse.json({ error: "You need two 30-minute PT credits for a stacked first visit." }, { status: 400 });
        }
      } else {
        const balance = getPTCreditBalance(db, member_id, duration_minutes);
        if (balance < 1) {
          db.close();
          return NextResponse.json({ error: `No ${duration_minutes}-min PT credits. Purchase a pack or add to cart.` }, { status: 400 });
        }
      }
    }

    const payment_type = pay_on_arrival ? "pay_on_arrival" : "credit";
    db.prepare("BEGIN").run();
    try {
      const insert = db.prepare(
        "INSERT INTO pt_open_bookings (member_id, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type, trainer_member_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        member_id,
        occurrence_date,
        start_time,
        scheduleDurationMinutes,
        pt_session_id,
        payment_type,
        trainerMemberId ?? null
      );
      const open_booking_id = insert.lastInsertRowid as number;

      if (!pay_on_arrival) {
        if (first_time_stack_30_credits) {
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_open_booking', ?)"
          ).run(
            member_id,
            session.duration_minutes,
            "First visit stacked 30-min credit (1 of 2)",
            `open:${open_booking_id}:stack1`
          );
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_open_booking', ?)"
          ).run(
            member_id,
            session.duration_minutes,
            "First visit stacked 30-min credit (2 of 2)",
            `open:${open_booking_id}:stack2`
          );
        } else {
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_open_booking', ?)"
          ).run(member_id, duration_minutes, `Booked ${duration_minutes}-min PT`, `open:${open_booking_id}`);
        }
      }
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      throw e;
    }

    if (trainerMemberId) ensureTrainerClient(db, trainerMemberId, member_id);

    const newBalance = pay_on_arrival
      ? undefined
      : first_time_stack_30_credits
        ? getPTCreditBalance(db, member_id, session.duration_minutes)
        : getPTCreditBalance(db, member_id, duration_minutes);

    // Email notifications: staff + trainer if we can resolve from session.trainer name
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || member_id : member_id;
      const whenStr = `${occurrence_date} ${start_time}`;
      const displaySessionName = first_time_stack_30_credits
        ? `${scheduleDurationMinutes} min first PT (2×30-min credits)`
        : session.session_name || `${duration_minutes} min PT`;

      const staffSubject = `PT booking: ${memberName} → ${displaySessionName}`;
      const staffBody = `${memberName} booked ${displaySessionName} on ${whenStr}.`;
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      let trainerRow =
        trainerMemberId != null
          ? (db
              .prepare(
                `SELECT m.email, m.first_name, m.last_name
                 FROM members m
                 WHERE m.member_id = ?`
              )
              .get(trainerMemberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined)
          : undefined;
      if (!trainerRow?.email?.trim()) {
        const trainerName = (session.trainer ?? "").trim();
        if (trainerName) {
          trainerRow = db
            .prepare(
              `SELECT m.email, m.first_name, m.last_name
               FROM trainers t
               JOIN members m ON m.member_id = t.member_id
               WHERE TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) = ?`
            )
            .get(trainerName) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
        }
      }
      const trainerEmail = trainerRow?.email?.trim();
      if (trainerEmail) {
        const trainerSubject = `New PT booking with ${memberName}`;
        const trainerBody = `${memberName} booked ${displaySessionName} on ${whenStr}.`;
        sendMemberEmail(trainerEmail, trainerSubject, trainerBody).catch(() => {});
      }

      const memberEmail = memberRow?.email?.trim();
      if (memberEmail) {
        const tz = getAppTimezone(db);
        const trainerDisplay = trainerDisplayForOpen(db, trainerMemberId, session.trainer);
        sendMemberBookingConfirmationEmail({
          to: memberEmail,
          memberFirstName: memberRow?.first_name,
          kind: "pt",
          sessionTitle: displaySessionName,
          dateYmd: occurrence_date,
          timeRaw: start_time,
          trainerDisplayName: trainerDisplay,
          timeZone: tz,
        }).catch(() => {});
      }
    } catch {
      // ignore email failures
    }

    db.close();
    return NextResponse.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to book PT slot" }, { status: 500 });
  }
}
