import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { ensureRecurringClassesTables, getNextOccurrenceDates } from "../../../../../../lib/recurring-classes";
import { hasPTAtSlot } from "../../../../../../lib/schedule-conflicts";

export const dynamic = "force-dynamic";

/** POST body: { weeks?: number, from_date?: string (YYYY-MM-DD) }. Generate from that date (or today). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({}));
    const weeks = Math.min(52, Math.max(1, parseInt(body.weeks, 10) || 12));
    const fromDate = (() => {
      const raw = body.from_date && String(body.from_date).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const d = new Date(raw + "T12:00:00");
        if (!Number.isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          return d;
        }
      }
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    })();

    const db = getDb();
    ensureRecurringClassesTables(db);
    const row = db.prepare("SELECT id, is_recurring, days_of_week, time, capacity FROM classes WHERE id = ?").get(id) as {
      is_recurring: number;
      days_of_week: string | null;
      time: string | null;
      capacity: string | number | null;
    } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }
    if (!row.is_recurring || !row.days_of_week?.trim()) {
      db.close();
      return NextResponse.json({ error: "Class must be recurring and have days_of_week set" }, { status: 400 });
    }
    const dates = getNextOccurrenceDates(row.days_of_week.trim(), (row.time ?? "18:00").toString().trim(), fromDate, weeks);
    const capacity = row.capacity != null ? (typeof row.capacity === "number" ? row.capacity : parseInt(String(row.capacity), 10) || 20) : 20;
    let inserted = 0;
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO class_occurrences (class_id, occurrence_date, occurrence_time, capacity)
      VALUES (?, ?, ?, ?)
    `);
    const timePart = (t: string) => {
      const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
      return ((parts[0] ?? 0) % 24) * 60 + (parts[1] ?? 0);
    };
    for (const { date, time } of dates) {
      if (hasPTAtSlot(db, date, timePart(time))) continue;
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
