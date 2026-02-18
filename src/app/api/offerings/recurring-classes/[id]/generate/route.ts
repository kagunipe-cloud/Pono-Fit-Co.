import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { ensureRecurringClassesTables, getNextOccurrenceDates } from "../../../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

/** POST body: { weeks?: number } — generate occurrences for the next N weeks (default 12). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({}));
    const weeks = Math.min(52, Math.max(1, parseInt(body.weeks, 10) || 12));
    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);

    const db = getDb();
    ensureRecurringClassesTables(db);
    const row = db.prepare("SELECT * FROM recurring_classes WHERE id = ?").get(id) as { days_of_week: string; time: string; capacity: number } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Recurring class not found" }, { status: 404 });
    }
    const dates = getNextOccurrenceDates(row.days_of_week, row.time || "18:00", fromDate, weeks);
    const capacity = row.capacity ?? 20;
    let inserted = 0;
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO class_occurrences (recurring_class_id, occurrence_date, occurrence_time, capacity)
      VALUES (?, ?, ?, ?)
    `);
    for (const { date, time } of dates) {
      const r = stmt.run(id, date, time, capacity);
      if (r.changes > 0) inserted++;
    }
    db.close();
    return NextResponse.json({ success: true, inserted, total: dates.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate occurrences" }, { status: 500 });
  }
}
