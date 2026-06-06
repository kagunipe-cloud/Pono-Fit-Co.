import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, getAppTimezone } from "@/lib/db";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { getMemberIdFromSession } from "@/lib/session";
import { getAdminMemberId, getTrainerMemberId } from "@/lib/admin";
import {
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
  OPEN_GROUP_MAX_PARTICIPANTS,
  SESSION_KIND_OPEN_GROUP_PT,
  SMALL_GROUP_PT_DISPLAY_NAME,
} from "@/lib/open-group-pt";
import {
  assertSmallGroupPtSlotFree,
  createSmallGroupPtOccurrence,
} from "@/lib/small-group-pt-booking";
import {
  sendStaffEmail,
  sendMemberEmail,
  sendMemberBookingConfirmationEmail,
  getTrainerDisplayNameFromMemberId,
} from "@/lib/email";
import { normalizePtDurationMinutes } from "@/lib/pt-slots";

export const dynamic = "force-dynamic";

/**
 * POST { occurrence_date, start_time, duration_minutes?, trainer_availability_id?, trainer_member_id?, member_id? }
 * Creates a one-off Small-Group PT occurrence at an open schedule time and books the member as organizer.
 * Admin may pass member_id to book on behalf of a member.
 */
export async function POST(request: NextRequest) {
  try {
    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    const isTrainer = !!(await getTrainerMemberId(request));
    if (!sessionMemberId && !isAdmin && !isTrainer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const bodyMemberId = String(body.member_id ?? "").trim();
    let memberId = sessionMemberId;
    if (bodyMemberId) {
      if (!isAdmin && !isTrainer) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      memberId = bodyMemberId;
    }
    if (!memberId) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }
    const occurrence_date = String(body.occurrence_date ?? "").trim();
    const start_time = String(body.start_time ?? "").trim().slice(0, 5);
    const duration_minutes = normalizePtDurationMinutes(body.duration_minutes, 60);
    const blockId = parseInt(String(body.trainer_availability_id ?? ""), 10);
    let trainer_member_id = String(body.trainer_member_id ?? "").trim() || null;

    if (!occurrence_date || !/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date) || !start_time) {
      return NextResponse.json({ error: "occurrence_date and start_time required" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (occurrence_date < today) {
      return NextResponse.json({ error: "Cannot book past times" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    if (!Number.isNaN(blockId)) {
      const block = db
        .prepare("SELECT trainer_member_id FROM trainer_availability WHERE id = ?")
        .get(blockId) as { trainer_member_id: string | null } | undefined;
      if (!block) {
        db.close();
        return NextResponse.json({ error: "Availability block not found" }, { status: 404 });
      }
      trainer_member_id = (block.trainer_member_id ?? "").trim() || trainer_member_id;
    }

    try {
      assertSmallGroupPtSlotFree(db, occurrence_date, start_time, duration_minutes, trainer_member_id);
    } catch (e) {
      db.close();
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "This time is not available" },
        { status: 409 }
      );
    }

    const occurrenceId = createSmallGroupPtOccurrence(db, {
      occurrence_date,
      occurrence_time: start_time,
      duration_minutes,
      trainer_member_id,
    });

    const token = randomUUID();
    db.prepare("UPDATE class_occurrences SET open_group_share_token = ? WHERE id = ?").run(token, occurrenceId);
    try {
      db.prepare(
        `INSERT INTO occurrence_bookings (member_id, class_occurrence_id, booking_role) VALUES (?, ?, 'organizer')`
      ).run(memberId, occurrenceId);
    } catch (e) {
      db.prepare("DELETE FROM class_occurrences WHERE id = ?").run(occurrenceId);
      db.prepare("DELETE FROM classes WHERE id = (SELECT class_id FROM class_occurrences WHERE id = ?)").run(occurrenceId);
      throw e;
    }

    const flatLabel = OPEN_GROUP_DEFAULT_FLAT_PRICE;
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow
        ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || memberId
        : memberId;
      const whenStr = `${occurrence_date} ${start_time}`.trim();
      const staffBody = `${memberName} started ${SMALL_GROUP_PT_DISPLAY_NAME} on ${whenStr}. Desk total $${flatLabel} (pay at gym).`;
      sendStaffEmail(`Small-Group PT: ${memberName}`, staffBody).catch(() => {});

      const classRow = db
        .prepare("SELECT trainer_member_id FROM classes WHERE id = (SELECT class_id FROM class_occurrences WHERE id = ?)")
        .get(occurrenceId) as { trainer_member_id: string | null } | undefined;
      const trainerId = (classRow?.trainer_member_id ?? trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db.prepare("SELECT email FROM members WHERE member_id = ?").get(trainerId) as
          | { email: string | null }
          | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          sendMemberEmail(trainerEmail, `Small-Group PT booking: ${whenStr}`, staffBody).catch(() => {});
        }
      }

      const memberEmail = memberRow?.email?.trim();
      if (memberEmail) {
        const tz = getAppTimezone(db);
        const trainerDisplay = getTrainerDisplayNameFromMemberId(db, trainerId || null);
        sendMemberBookingConfirmationEmail({
          to: memberEmail,
          memberFirstName: memberRow?.first_name,
          kind: "class",
          sessionTitle: `${SMALL_GROUP_PT_DISPLAY_NAME} — $${flatLabel} total at gym`,
          dateYmd: occurrence_date,
          timeRaw: start_time,
          trainerDisplayName: trainerDisplay,
          timeZone: tz,
        }).catch(() => {});
      }
    } catch {
      /* email optional */
    }

    db.close();

    const origin = request.nextUrl.origin;
    const share_url = `${origin}/member/open-group-pt/join?occurrence_id=${occurrenceId}&token=${encodeURIComponent(token)}`;

    return NextResponse.json({
      success: true,
      occurrence_id: occurrenceId,
      session_kind: SESSION_KIND_OPEN_GROUP_PT,
      share_url,
      flat_session_price: flatLabel,
      capacity: OPEN_GROUP_MAX_PARTICIPANTS,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Booking failed" }, { status: 500 });
  }
}
