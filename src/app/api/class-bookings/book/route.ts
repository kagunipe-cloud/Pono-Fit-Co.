import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../lib/session";
import { sendStaffEmail, sendMemberEmail } from "../../../../lib/email";

export const dynamic = "force-dynamic";

/** POST { class_occurrence_id: number } — book one occurrence using 1 class credit. */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const occurrenceId = parseInt(body.class_occurrence_id, 10);
    if (Number.isNaN(occurrenceId)) {
      return NextResponse.json({ error: "Invalid class_occurrence_id" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);
    const balance = getMemberCreditBalance(db, memberId);
    if (balance < 1) {
      db.close();
      return NextResponse.json({ error: "No class credits. Purchase a class pack first." }, { status: 400 });
    }
    const occurrence = db
      .prepare(
        `SELECT o.id,
                o.occurrence_date,
                o.occurrence_time,
                COALESCE(c.class_name, r.name) AS class_name,
                c.trainer_member_id
         FROM class_occurrences o
         LEFT JOIN classes c ON c.id = o.class_id
         LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
         WHERE o.id = ?`
      )
      .get(occurrenceId) as { id: number; occurrence_date: string; occurrence_time: string | null; class_name: string | null; trainer_member_id: string | null } | undefined;
    if (!occurrence) {
      db.close();
      return NextResponse.json({ error: "Class occurrence not found" }, { status: 404 });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (occurrence.occurrence_date < today) {
      db.close();
      return NextResponse.json({ error: "Cannot book past classes" }, { status: 400 });
    }
    try {
      db.prepare("INSERT INTO occurrence_bookings (member_id, class_occurrence_id) VALUES (?, ?)").run(memberId, occurrenceId);
      db.prepare(`
        INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
        VALUES (?, -1, 'booking', 'occurrence_booking', ?)
      `).run(memberId, String(occurrenceId));
    } catch (e) {
      const err = e as { message?: string };
      if (err.message?.includes("UNIQUE")) {
        db.close();
        return NextResponse.json({ error: "You are already booked for this class" }, { status: 400 });
      }
      throw e;
    }
    const newBalance = getMemberCreditBalance(db, memberId);

    // Email notifications: staff + assigned trainer (if any)
    try {
      const memberRow = db
        .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
        .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || memberId : memberId;
      const whenStr = `${occurrence.occurrence_date} ${occurrence.occurrence_time ?? ""}`.trim();
      const className = occurrence.class_name || "Class";

      const staffSubject = `Class booking: ${memberName} → ${className}`;
      const staffBody = `${memberName} booked ${className} on ${whenStr || occurrence.occurrence_date}.`;
      // Fire and forget
      sendStaffEmail(staffSubject, staffBody).catch(() => {});

      const trainerId = (occurrence.trainer_member_id ?? "").trim();
      if (trainerId) {
        const trainerRow = db
          .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
          .get(trainerId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
        const trainerEmail = trainerRow?.email?.trim();
        if (trainerEmail) {
          const trainerSubject = `New class booking for ${className}`;
          const trainerBody = `${memberName} booked your class "${className}" on ${whenStr || occurrence.occurrence_date}.`;
          sendMemberEmail(trainerEmail, trainerSubject, trainerBody).catch(() => {});
        }
      }
    } catch {
      // Don't block booking on email issues
    }

    db.close();
    return NextResponse.json({ success: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Booking failed" }, { status: 500 });
  }
}
