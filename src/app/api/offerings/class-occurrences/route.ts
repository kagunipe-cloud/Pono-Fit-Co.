import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: from=today, to=+4 weeks). Returns occurrences with class name, price, and booking count. */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let from = searchParams.get("from")?.trim();
    let to = searchParams.get("to")?.trim();
    const today = new Date().toISOString().slice(0, 10);
    if (!from) from = today;
    const toDate = to ? new Date(to) : (() => { const d = new Date(); d.setDate(d.getDate() + 28); return d; })();
    if (!to) to = toDate.toISOString().slice(0, 10);

    const db = getDb();
    ensureRecurringClassesTables(db);
    const rows = db.prepare(`
      SELECT o.id, o.class_id, o.recurring_class_id, o.occurrence_date, o.occurrence_time, o.capacity,
             COALESCE(c.class_name, r.name) AS class_name,
             COALESCE(c.instructor, r.instructor) AS instructor,
             COALESCE(c.price, '0') AS price,
             COALESCE(c.duration_minutes, r.duration_minutes, 60) AS duration_minutes,
             (SELECT COUNT(*) FROM occurrence_bookings b WHERE b.class_occurrence_id = o.id) AS booked_count
      FROM class_occurrences o
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
      WHERE o.occurrence_date >= ? AND o.occurrence_date <= ?
        AND (o.class_id IS NOT NULL OR o.recurring_class_id IS NOT NULL)
      ORDER BY o.occurrence_date ASC, o.occurrence_time ASC
    `).all(from, to) as Record<string, unknown>[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch occurrences" }, { status: 500 });
  }
}
