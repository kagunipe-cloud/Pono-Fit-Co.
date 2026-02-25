import { NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../lib/session";
import { formatInAppTz, todayInAppTz } from "../../../../lib/app-timezone";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    const member = db.prepare(
      "SELECT member_id, first_name, last_name, email FROM members WHERE member_id = ?"
    ).get(memberId) as { member_id: string; first_name: string | null; last_name: string | null; email: string | null } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 401 });
    }

    let subscriptions: Record<string, unknown>[] = [];
    let classBookings: Record<string, unknown>[] = [];
    let occurrenceBookings: Record<string, unknown>[] = [];
    try {
      subscriptions = db.prepare(`
        SELECT s.*, p.plan_name, p.price as plan_price
        FROM subscriptions s
        LEFT JOIN membership_plans p ON p.product_id = s.product_id
        WHERE s.member_id = ?
        ORDER BY s.start_date DESC
      `).all(memberId) as Record<string, unknown>[];
    } catch {
      /* subscriptions table may be empty schema */
    }
    try {
      classBookings = db.prepare(`
        SELECT b.*, c.class_name, c.date as class_date, c.time as class_time
        FROM class_bookings b
        LEFT JOIN classes c ON c.product_id = b.product_id
        WHERE b.member_id = ?
        ORDER BY b.booking_date DESC
      `).all(memberId) as Record<string, unknown>[];
    } catch {
      /* class_bookings / classes may not exist */
    }

    try {
      ensureRecurringClassesTables(db);
      occurrenceBookings = db.prepare(`
      SELECT ob.id, ob.class_occurrence_id, ob.created_at,
             o.occurrence_date, o.occurrence_time,
             COALESCE(c.class_name, r.name) AS class_name
      FROM occurrence_bookings ob
      JOIN class_occurrences o ON o.id = ob.class_occurrence_id
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
      WHERE ob.member_id = ?
      ORDER BY o.occurrence_date ASC, o.occurrence_time ASC
    `).all(memberId) as Record<string, unknown>[];
    } catch {
      /* recurring/occurrence tables may not exist */
    }
    let classCredits = 0;
    try {
      classCredits = getMemberCreditBalance(db, memberId);
    } catch {
      /* ignore */
    }

    let ptBookingsLegacy: Record<string, unknown>[] = [];
    try {
      ptBookingsLegacy = db.prepare(`
        SELECT b.*, p.session_name, p.date_time as session_date
        FROM pt_bookings b
        LEFT JOIN pt_sessions p ON p.product_id = b.product_id
        WHERE b.member_id = ?
        ORDER BY b.booking_date DESC
      `).all(memberId) as Record<string, unknown>[];
    } catch {
      /* pt_bookings table may not exist */
    }

    let ptBlockBookingsFormatted: Record<string, unknown>[] = [];
    let ptOpenBookingsFormatted: Record<string, unknown>[] = [];
    try {
      ensurePTSlotTables(db);
      const ptBlockBookings = db.prepare(`
        SELECT b.id, b.occurrence_date, b.start_time, b.session_duration_minutes, b.payment_type, b.created_at, a.trainer
        FROM pt_block_bookings b
        JOIN trainer_availability a ON a.id = b.trainer_availability_id
        WHERE b.member_id = ?
        ORDER BY b.occurrence_date DESC, b.start_time DESC
      `).all(memberId) as { id: number; occurrence_date: string; start_time: string; session_duration_minutes: number; payment_type: string; created_at: string; trainer: string }[];

      ptBlockBookingsFormatted = ptBlockBookings.map((b) => ({
        id: b.id,
        session_name: `${b.trainer} PT (${b.session_duration_minutes} min)`,
        session_date: `${b.occurrence_date} ${b.start_time}`,
        booking_date: b.occurrence_date,
        payment_status: b.payment_type,
        source: "block",
      }));

      const ptOpenBookings = db.prepare(`
        SELECT ob.id, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.payment_type, p.session_name
        FROM pt_open_bookings ob
        JOIN pt_sessions p ON p.id = ob.pt_session_id
        WHERE ob.member_id = ?
        ORDER BY ob.occurrence_date DESC, ob.start_time DESC
      `).all(memberId) as { id: number; occurrence_date: string; start_time: string; duration_minutes: number; payment_type: string; session_name: string }[];

      ptOpenBookingsFormatted = ptOpenBookings.map((b) => ({
        id: b.id,
        session_name: b.session_name || `${b.duration_minutes} min PT`,
        session_date: `${b.occurrence_date} ${b.start_time}`,
        booking_date: b.occurrence_date,
        payment_status: b.payment_type,
        source: "open_slot",
      }));
    } catch {
      /* pt tables may not exist */
    }

    const ptBookings = [...ptBookingsLegacy, ...ptBlockBookingsFormatted, ...ptOpenBookingsFormatted].sort((a, b) => {
      const dA = String(a.session_date ?? a.booking_date ?? "");
      const dB = String(b.session_date ?? b.booking_date ?? "");
      return dB.localeCompare(dA);
    });

    const tz = getAppTimezone(db);
    db.close();

    const today = todayInAppTz(tz);
    const hasAccess = subscriptions.some(
      (s) => s.status === "Active" && String(s.expiry_date ?? "") >= today
    );

    return NextResponse.json({
      member: {
        member_id: member.member_id,
        first_name: member.first_name,
        last_name: member.last_name,
        email: member.email,
        name: [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member",
      },
      subscriptions,
      classBookings,
      occurrenceBookings,
      classCredits,
      ptBookings,
      hasAccess,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
