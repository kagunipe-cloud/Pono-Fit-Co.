import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

/** GET a single class occurrence by id (for admin book-class-for-member). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensureRecurringClassesTables(db);
    const row = db.prepare(`
      SELECT o.id, o.occurrence_date, o.occurrence_time, o.capacity,
             COALESCE(c.class_name, r.name) AS class_name,
             COALESCE(c.instructor, r.instructor) AS instructor,
             COALESCE(c.price, '0') AS price,
             (SELECT COUNT(*) FROM occurrence_bookings b WHERE b.class_occurrence_id = o.id) AS booked_count
      FROM class_occurrences o
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
      WHERE o.id = ? AND (o.class_id IS NOT NULL OR o.recurring_class_id IS NOT NULL)
    `).get(numericId) as { id: number; occurrence_date: string; occurrence_time: string; capacity: number | null; class_name: string | null; instructor: string | null; price: string; booked_count: number } | undefined;
    db.close();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch occurrence" }, { status: 500 });
  }
}

/** DELETE a single class occurrence (and its bookings). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensureRecurringClassesTables(db);
    const exists = db.prepare("SELECT 1 FROM class_occurrences WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM occurrence_bookings WHERE class_occurrence_id = ?").run(numericId);
    db.prepare("DELETE FROM class_occurrences WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete occurrence" }, { status: 500 });
  }
}
