import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../lib/session";

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
    const occurrence = db.prepare("SELECT id, occurrence_date FROM class_occurrences WHERE id = ?").get(occurrenceId) as { id: number; occurrence_date: string } | undefined;
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
    db.close();
    return NextResponse.json({ success: true, balance: newBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Booking failed" }, { status: 500 });
  }
}
