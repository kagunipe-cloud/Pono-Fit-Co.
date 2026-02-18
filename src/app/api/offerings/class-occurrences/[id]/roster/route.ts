import { NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    const occurrence = db.prepare(`
      SELECT o.id, o.occurrence_date, o.occurrence_time, o.capacity,
             COALESCE(c.class_name, r.name) AS class_name,
             COALESCE(c.instructor, r.instructor) AS instructor
      FROM class_occurrences o
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
      WHERE o.id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!occurrence) {
      db.close();
      return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
    }
    const members = db.prepare(`
      SELECT m.member_id, m.first_name, m.last_name, m.email, b.created_at AS booked_at
      FROM occurrence_bookings b
      JOIN members m ON m.member_id = b.member_id
      WHERE b.class_occurrence_id = ?
      ORDER BY b.created_at ASC
    `).all(id) as Record<string, unknown>[];
    db.close();
    return NextResponse.json({ occurrence, members });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch roster" }, { status: 500 });
  }
}
