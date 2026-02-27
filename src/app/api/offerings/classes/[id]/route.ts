import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { hasPTAtSlot, classDateTimeToMinutes } from "../../../../../lib/schedule-conflicts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM classes WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const fields = ["product_id", "class_name", "instructor", "trainer_member_id", "date", "time", "capacity", "status", "price", "stripe_link", "category", "description", "image_url", "is_recurring", "days_of_week", "duration_minutes"] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(typeof body[f] === "string" ? body[f].trim() : body[f]);
      }
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    const db = getDb();
    const current = db.prepare("SELECT date, time, is_recurring FROM classes WHERE id = ?").get(numericId) as { date: string | null; time: string | null; is_recurring: number } | undefined;
    if (current && !current.is_recurring) {
      const date = (body.date !== undefined ? String(body.date).trim() : current.date) || "";
      const time = (body.time !== undefined ? String(body.time).trim() : current.time) || "";
      if (date && time && hasPTAtSlot(db, date, classDateTimeToMinutes(date, time))) {
        db.close();
        return NextResponse.json({ error: "A PT session is already scheduled at this date and time. Choose a different slot." }, { status: 409 });
      }
    }
    values.push(numericId);
    db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM classes WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    const exists = db.prepare("SELECT 1 FROM classes WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Remove dependent rows: bookings on occurrences, then occurrences for this class
    db.prepare(
      "DELETE FROM occurrence_bookings WHERE class_occurrence_id IN (SELECT id FROM class_occurrences WHERE class_id = ?)"
    ).run(numericId);
    db.prepare("DELETE FROM class_occurrences WHERE class_id = ?").run(numericId);
    db.prepare("DELETE FROM classes WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete class" }, { status: 500 });
  }
}
