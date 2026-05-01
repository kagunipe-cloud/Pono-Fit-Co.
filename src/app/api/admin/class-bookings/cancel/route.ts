import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { ensureRecurringClassesTables } from "../../../../../lib/recurring-classes";
import { isOpenGroupSessionKind } from "../../../../../lib/open-group-pt";
import { sendStaffEmail, sendMemberEmail } from "../../../../../lib/email";

export const dynamic = "force-dynamic";

/** POST { occurrence_booking_id: number } | { occurrence_booking_ids: number[] } — Admin only. Cancels class occurrence booking(s) and restores 1 credit each. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    let ids: number[] = [];
    if (Array.isArray(body.occurrence_booking_ids)) {
      ids = body.occurrence_booking_ids
        .map((x: unknown) => parseInt(String(x), 10))
        .filter((n: number) => !Number.isNaN(n));
    } else {
      const single = parseInt(String(body.occurrence_booking_id), 10);
      if (!Number.isNaN(single)) ids = [single];
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "occurrence_booking_id or occurrence_booking_ids required" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);

    const clearedOpenGroupOccurrences = new Set<number>();

    for (const occurrence_booking_id of ids) {
      const booking = db
        .prepare(
          `SELECT ob.id, ob.member_id, ob.class_occurrence_id,
                  COALESCE(ob.booking_role, 'standard') AS booking_role,
                  o.occurrence_date, o.occurrence_time,
                  COALESCE(c.class_name, r.name) AS class_name,
                  COALESCE(r.session_kind, 'standard') AS session_kind,
                  c.trainer_member_id
           FROM occurrence_bookings ob
           JOIN class_occurrences o ON o.id = ob.class_occurrence_id
           LEFT JOIN classes c ON c.id = o.class_id
           LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
           WHERE ob.id = ?`
        )
        .get(occurrence_booking_id) as
        | {
            id: number;
            member_id: string;
            class_occurrence_id: number;
            booking_role: string;
            occurrence_date: string;
            occurrence_time: string | null;
            class_name: string | null;
            session_kind: string;
            trainer_member_id: string | null;
          }
        | undefined;

      if (!booking) continue;
      if (clearedOpenGroupOccurrences.has(booking.class_occurrence_id)) continue;

      const openGroup = isOpenGroupSessionKind(booking.session_kind);

      if (openGroup && booking.booking_role === "organizer") {
        db.prepare("DELETE FROM occurrence_bookings WHERE class_occurrence_id = ?").run(booking.class_occurrence_id);
        db.prepare("UPDATE class_occurrences SET open_group_share_token = NULL WHERE id = ?").run(booking.class_occurrence_id);
        clearedOpenGroupOccurrences.add(booking.class_occurrence_id);
        try {
          const whenStr = `${booking.occurrence_date} ${booking.occurrence_time ?? ""}`.trim();
          const className = booking.class_name || "Open Group Personal Training";
          sendStaffEmail(
            `Open Group PT cancelled (admin): ${className}`,
            `An admin removed the whole group for ${className} on ${whenStr || booking.occurrence_date}.`
          ).catch(() => {});
        } catch {
          /* ignore */
        }
        continue;
      }

      if (openGroup && booking.booking_role === "guest") {
        db.prepare("DELETE FROM occurrence_bookings WHERE id = ?").run(occurrence_booking_id);
        try {
          const memberRow = db
            .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
            .get(booking.member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
          const memberName = memberRow
            ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || booking.member_id
            : booking.member_id;
          const whenStr = `${booking.occurrence_date} ${booking.occurrence_time ?? ""}`.trim();
          const className = booking.class_name || "Open Group Personal Training";
          sendStaffEmail(
            `Open Group PT guest removed (admin): ${memberName} → ${className}`,
            `An admin cancelled ${memberName}'s spot for ${className} on ${whenStr || booking.occurrence_date}.`
          ).catch(() => {});
          const trainerId = (booking.trainer_member_id ?? "").trim();
          if (trainerId) {
            const trainerRow = db.prepare("SELECT email FROM members WHERE member_id = ?").get(trainerId) as { email: string | null } | undefined;
            const trainerEmail = trainerRow?.email?.trim();
            if (trainerEmail) {
              sendMemberEmail(
                trainerEmail,
                `Open Group PT update: ${className}`,
                `${memberName} was removed from "${className}" on ${whenStr || booking.occurrence_date}.`
              ).catch(() => {});
            }
          }
        } catch {
          /* ignore */
        }
        continue;
      }

      db.prepare("DELETE FROM occurrence_bookings WHERE id = ?").run(occurrence_booking_id);
      db.prepare(
        `INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
         VALUES (?, 1, 'admin_cancel', 'occurrence_booking', ?)`
      ).run(booking.member_id, String(occurrence_booking_id));

      try {
        const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(booking.member_id) as {
          email: string | null;
          first_name: string | null;
          last_name: string | null;
        } | undefined;
        const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || booking.member_id : booking.member_id;
        const whenStr = `${booking.occurrence_date} ${booking.occurrence_time ?? ""}`.trim();
        const className = booking.class_name || "Class";

        const staffSubject = `Class booking cancelled (admin): ${memberName} → ${className}`;
        const staffBody = `An admin cancelled ${memberName}'s booking for ${className} on ${whenStr || booking.occurrence_date}.`;
        sendStaffEmail(staffSubject, staffBody).catch(() => {});

        const trainerId = (booking.trainer_member_id ?? "").trim();
        if (trainerId) {
          const trainerRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(trainerId) as { email: string | null } | undefined;
          const trainerEmail = trainerRow?.email?.trim();
          if (trainerEmail) {
            const trainerSubject = `Class booking cancelled for ${className}`;
            const trainerBody = `${memberName} cancelled their spot in your class "${className}" on ${whenStr || booking.occurrence_date}.`;
            sendMemberEmail(trainerEmail, trainerSubject, trainerBody).catch(() => {});
          }
        }
      } catch {
        /* ignore email errors */
      }
    }

    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel class booking" }, { status: 500 });
  }
}
