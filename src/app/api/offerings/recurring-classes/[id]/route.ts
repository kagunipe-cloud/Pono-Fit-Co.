import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    const row = db.prepare("SELECT * FROM recurring_classes WHERE id = ?").get(id);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const body = await request.json();
    const name = (body.name ?? "").trim() || null;
    const instructor = (body.instructor ?? "").trim() || null;
    const duration_minutes = body.duration_minutes != null ? Math.max(1, parseInt(body.duration_minutes, 10) || 60) : undefined;
    const capacity = body.capacity != null ? Math.max(1, parseInt(body.capacity, 10) || 20) : undefined;
    const days_of_week = (body.days_of_week ?? "").trim();
    const time = (body.time ?? "").trim();

    const db = getDb();
    ensureRecurringClassesTables(db);
    const existing = db.prepare("SELECT id FROM recurring_classes WHERE id = ?").get(id);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) { updates.push("name = ?"); values.push(name); }
    if (instructor !== undefined) { updates.push("instructor = ?"); values.push(instructor); }
    if (duration_minutes !== undefined) { updates.push("duration_minutes = ?"); values.push(duration_minutes); }
    if (capacity !== undefined) { updates.push("capacity = ?"); values.push(capacity); }
    if (days_of_week !== undefined && days_of_week !== "") { updates.push("days_of_week = ?"); values.push(days_of_week); }
    if (time !== undefined && time !== "") { updates.push("time = ?"); values.push(time); }
    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE recurring_classes SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM recurring_classes WHERE id = ?").get(id);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    db.prepare("DELETE FROM occurrence_bookings WHERE class_occurrence_id IN (SELECT id FROM class_occurrences WHERE recurring_class_id = ?)").run(id);
    db.prepare("DELETE FROM class_occurrences WHERE recurring_class_id = ?").run(id);
    db.prepare("DELETE FROM recurring_classes WHERE id = ?").run(id);
    db.close();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
