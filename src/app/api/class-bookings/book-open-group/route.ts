import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, getAppTimezone } from "@/lib/db";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "@/lib/recurring-classes";
import { getMemberIdFromSession } from "@/lib/session";
import {
  effectiveOpenGroupCapacity,
  isOpenGroupSessionKind,
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
  SESSION_KIND_OPEN_GROUP_PT,
} from "@/lib/open-group-pt";
import {
  sendStaffEmail,
  sendMemberEmail,
  sendMemberBookingConfirmationEmail,
  getTrainerDisplayNameFromMemberId,
} from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST { class_occurrence_id: number, invite_token?: string }
 * Organizer: no token when slot is empty. Guest: invite_token must match occurrence.open_group_share_token.
 * No class credits; flat fee collected at the gym.
 */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const occurrenceId = parseInt(String(body.class_occurrence_id), 10);
    const inviteToken = typeof body.invite_token === "string" ? body.invite_token.trim() : "";
    if (Number.isNaN(occurrenceId)) {
      return NextResponse.json({ error: "Invalid class_occurrence_id" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);

    const occurrence = db
      .prepare(
        `SELECT o.id,
                o.capacity,
                o.open_group_share_token,
                o.occurrence_date,
                o.occurrence_time,
                COALESCE(r.session_kind, 'standard') AS session_kind,
                NULLIF(TRIM(r.flat_session_price), '') AS flat_session_price,
                COALESCE(c.class_name, r.name) AS class_name,
                c.trainer_member_id
         FROM class_occurrences o
         LEFT JOIN classes c ON c.id = o.class_id
         LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
         WHERE o.id = ?`
      )
      .get(occurrenceId) as
      | {
          id: number;
          capacity: number | null;
          open_group_share_token: string | null;
          occurrence_date: string;
          occurrence_time: string | null;
          session_kind: string;
          flat_session_price: string | null;
          class_name: string | null;
          trainer_member_id: string | null;
        }
      | undefined;

    if (!occurrence || !isOpenGroupSessionKind(occurrence.session_kind)) {
      db.close();
      return NextResponse.json({ error: "This slot is not Open Group Personal Training." }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (occurrence.occurrence_date < today) {
      db.close();
      return NextResponse.json({ error: "Cannot book past classes" }, { status: 400 });
    }

    const cap = effectiveOpenGroupCapacity(occurrence.capacity);
    const flatLabel = occurrence.flat_session_price ?? OPEN_GROUP_DEFAULT_FLAT_PRICE;

    const countRow = db
      .prepare("SELECT COUNT(*) AS n FROM occurrence_bookings WHERE class_occurrence_id = ?")
      .get(occurrenceId) as { n: number };
    const booked = countRow?.n ?? 0;

    if (inviteToken) {
      const tok = (occurrence.open_group_share_token ?? "").trim();
      if (!tok || tok !== inviteToken) {
        db.close();
        return NextResponse.json({ error: "Invalid or expired invite link." }, { status: 403 });
      }
      if (booked === 0) {
        db.close();
        return NextResponse.json({ error: "This group has not been started yet." }, { status: 400 });
      }
      if (booked >= cap) {
        db.close();
        return NextResponse.json({ error: "This group is full." }, { status: 400 });
      }
      try {
        db.prepare(
          `INSERT INTO occurrence_bookings (member_id, class_occurrence_id, booking_role) VALUES (?, ?, 'guest')`
        ).run(memberId, occurrenceId);
      } catch (e) {
        const err = e as { message?: string };
        if (err.message?.includes("UNIQUE")) {
          db.close();
          return NextResponse.json({ error: "You are already in this group." }, { status: 400 });
        }
        throw e;
      }
    } else {
      if (booked > 0) {
        db.close();
        return NextResponse.json(
          {
            error: "Someone already reserved this slot. Ask them for the invite link to join their group.",
            need_invite: true,
          },
          { status: 400 }
        );
      }
      const token = randomUUID();
      db.prepare("UPDATE class_occurrences SET open_group_share_token = ? WHERE id = ?").run(token, occurrenceId);
      try {
        db.prepare(
          `INSERT INTO occurrence_bookings (member_id, class_occurrence_id, booking_role) VALUES (?, ?, 'organizer')`
        ).run(memberId, occurrenceId);
      } catch (e) {
        db.prepare("UPDATE class_occurrences SET open_group_share_token = NULL WHERE id = ?").run(occurrenceId);
        throw e;
      }
    }

    const balance = getMemberCreditBalance(db, memberId);

    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || memberId : memberId;
      const whenStr = `${occurrence.occurrence_date} ${occurrence.occurrence_time ?? ""}`.trim();
      const className = occurrence.class_name || "Open Group Personal Training";

      const staffSubject = `Open Group PT: ${memberName} → ${className}`;
      const staffBody = `${memberName} ${inviteToken ? "joined" : "started"} "${className}" on ${whenStr || occurrence.occurrence_date}. Desk total $${flatLabel} (pay at gym).`;
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      const trainerId = (occurrence.trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db
          .prepare("SELECT email FROM members WHERE member_id = ?")
          .get(trainerId) as { email: string | null } | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          sendMemberEmail(trainerEmail, `Open Group PT booking: ${className}`, staffBody).catch(() => {});
        }
      }

      const memberEmail = memberRow?.email?.trim();
      if (memberEmail) {
        const tz = getAppTimezone(db);
        const trainerDisplay = getTrainerDisplayNameFromMemberId(db, occurrence.trainer_member_id);
        sendMemberBookingConfirmationEmail({
          to: memberEmail,
          memberFirstName: memberRow?.first_name,
          kind: "class",
          sessionTitle: `${className} — $${flatLabel} total at gym`,
          dateYmd: occurrence.occurrence_date,
          timeRaw: occurrence.occurrence_time ?? "",
          trainerDisplayName: trainerDisplay,
          timeZone: tz,
        }).catch(() => {});
      }
    } catch {
      /* ignore email */
    }

    const refreshed = db
      .prepare("SELECT open_group_share_token FROM class_occurrences WHERE id = ?")
      .get(occurrenceId) as { open_group_share_token: string | null } | undefined;

    db.close();

    const origin = request.nextUrl.origin;
    const sharePath = `/member/open-group-pt/join?occurrence_id=${occurrenceId}&token=${encodeURIComponent((refreshed?.open_group_share_token ?? "").trim())}`;
    const share_url = `${origin}${sharePath}`;

    return NextResponse.json({
      success: true,
      balance,
      session_kind: SESSION_KIND_OPEN_GROUP_PT,
      share_url: inviteToken ? undefined : share_url,
      flat_session_price: flatLabel,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Booking failed" }, { status: 500 });
  }
}
