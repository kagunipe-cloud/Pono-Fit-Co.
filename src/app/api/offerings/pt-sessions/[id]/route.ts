import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { hasClassAtSlot, ptDateTimeToSlot } from "../../../../../lib/schedule-conflicts";

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
    const row = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT session" }, { status: 500 });
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
    const fields = ["product_id", "session_name", "session_duration", "date_time", "price", "trainer", "stripe_link", "category", "description", "duration_minutes", "image_url"] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        const raw = typeof body[f] === "string" ? body[f].trim() : body[f];
        values.push(f === "date_time" && (raw === "" || raw == null) ? null : raw);
      }
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    if (body.date_time !== undefined) {
      const dbCheck = getDb();
      const slot = ptDateTimeToSlot(typeof body.date_time === "string" ? body.date_time : null);
      if (slot && hasClassAtSlot(dbCheck, slot.date, slot.timeMinutes)) {
        dbCheck.close();
        return NextResponse.json({ error: "A class is already scheduled at this date and time. Choose a different slot." }, { status: 409 });
      }
      dbCheck.close();
    }
    values.push(numericId);
    const db = getDb();
    db.prepare(`UPDATE pt_sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update PT session" }, { status: 500 });
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
    const exists = db.prepare("SELECT 1 FROM pt_sessions WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM pt_sessions WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete PT session" }, { status: 500 });
  }
}
