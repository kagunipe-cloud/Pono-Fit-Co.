import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { ensureRecurringClassesTables } from "@/lib/recurring-classes";
import { getMemberIdFromSession } from "@/lib/session";
import { sendStaffEmail, sendMemberEmail } from "@/lib/email";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";
import { isOpenGroupSessionKind } from "@/lib/open-group-pt";

export const dynamic = "force-dynamic";

/** DELETE — Member cancels a class occurrence booking they own, if at least 24h before class. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }
    const bookingIdStr = (await params).id;
    const bookingId = parseInt(bookingIdStr, 10);
    if (Number.isNaN(bookingId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);

    const booking = db
      .prepare(
        `SELECT ob.id,
                ob.member_id,
                ob.class_occurrence_id,
                COALESCE(ob.booking_role, 'standard') AS booking_role,
                COALESCE(r.session_kind, 'standard') AS session_kind,
                o.occurrence_date,
                o.occurrence_time,
                COALESCE(c.class_name, r.name) AS class_name,
                c.trainer_member_id
         FROM occurrence_bookings ob
         JOIN class_occurrences o ON o.id = ob.class_occurrence_id
         LEFT JOIN classes c ON c.id = o.class_id
         LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
         WHERE ob.id = ?`
      )
      .get(bookingId) as
      | {
          id: number;
          member_id: string;
          class_occurrence_id: number;
          booking_role: string;
          session_kind: string;
          occurrence_date: string;
          occurrence_time: string | null;
          class_name: string | null;
          trainer_member_id: string | null;
        }
      | undefined;

    if (!booking || booking.member_id !== memberId) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Enforce 24h cutoff
    const tz = getAppTimezone(db);
    const nowStr = formatDateTimeInAppTz(new Date(), undefined, tz);
    const now = new Date(nowStr);
    const whenIso = `${booking.occurrence_date}T${(booking.occurrence_time ?? "00:00:00").slice(0, 8)}Z`;
    const when = new Date(whenIso);
    const diffMs = when.getTime() - now.getTime();
    if (diffMs < 24 * 60 * 60 * 1000) {
      db.close();
      return NextResponse.json({ error: "You can only cancel classes at least 24 hours before the start time." }, { status: 400 });
    }

    const openGroup = isOpenGroupSessionKind(booking.session_kind);
    const role = booking.booking_role || "standard";

    if (openGroup && role === "organizer") {
      db.prepare("DELETE FROM occurrence_bookings WHERE class_occurrence_id = ?").run(booking.class_occurrence_id);
      db.prepare("UPDATE class_occurrences SET open_group_share_token = NULL WHERE id = ?").run(booking.class_occurrence_id);
    } else if (openGroup && role === "guest") {
      db.prepare("DELETE FROM occurrence_bookings WHERE id = ?").run(bookingId);
    } else {
      db.prepare("DELETE FROM occurrence_bookings WHERE id = ?").run(bookingId);
      db.prepare(
        `INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
       VALUES (?, 1, 'member_cancel', 'occurrence_booking', ?)`
      ).run(memberId, String(bookingId));
    }

    // Email notifications
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || memberId : memberId;
      const whenStr = `${booking.occurrence_date} ${booking.occurrence_time ?? ""}`.trim();
      const className = booking.class_name || "Class";

      const staffSubject =
        openGroup && role === "organizer"
          ? `Open Group PT cancelled: ${className}`
          : `Class cancellation: ${memberName} → ${className}`;
      const staffBody =
        openGroup && role === "organizer"
          ? `${memberName} cancelled the Open Group PT session "${className}" on ${whenStr || booking.occurrence_date} (entire group released).`
          : `${memberName} cancelled their booking for ${className} on ${whenStr || booking.occurrence_date}.`;
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      const trainerId = (booking.trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db
          .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
          .get(trainerId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          const trainerSubject =
            openGroup && role === "organizer" ? `Open Group PT cancelled: ${className}` : `Class booking cancelled for ${className}`;
          sendMemberEmail(trainerEmail, trainerSubject, staffBody).catch(() => {});
        }
      }
    } catch {
      // ignore email issues
    }

    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
}

