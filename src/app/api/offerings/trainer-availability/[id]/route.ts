import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

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
    ensurePTSlotTables(db);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch availability block" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json();
    const db = getDb();
    ensurePTSlotTables(db);
    const exists = db.prepare("SELECT 1 FROM trainer_availability WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Availability block not found" }, { status: 404 });
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.trainer !== undefined) { updates.push("trainer = ?"); values.push(String(body.trainer).trim()); }
    if (body.day_of_week !== undefined) { updates.push("day_of_week = ?"); values.push(Math.max(0, Math.min(6, parseInt(String(body.day_of_week), 10) || 0))); }
    if (body.start_time !== undefined) { updates.push("start_time = ?"); values.push(String(body.start_time).trim()); }
    if (body.end_time !== undefined) { updates.push("end_time = ?"); values.push(String(body.end_time).trim()); }
    if (body.description !== undefined) { updates.push("description = ?"); values.push((String(body.description).trim() || null) as string); }
    if (body.days_of_week !== undefined) { updates.push("days_of_week = ?"); values.push((String(body.days_of_week).trim() || null) as string); }
    if (updates.length === 0) {
      db.close();
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    values.push(numericId);
    db.prepare(`UPDATE trainer_availability SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(numericId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update availability block" }, { status: 500 });
  }
}

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
    ensurePTSlotTables(db);

    const exists = db.prepare("SELECT 1 FROM trainer_availability WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Availability block not found" }, { status: 404 });
    }

    db.prepare("DELETE FROM pt_block_bookings WHERE trainer_availability_id = ?").run(numericId);
    db.prepare("DELETE FROM trainer_availability WHERE id = ?").run(numericId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete availability block" }, { status: 500 });
  }
}
