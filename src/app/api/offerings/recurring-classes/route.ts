import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables, getNextOccurrenceDates } from "../../../../lib/recurring-classes";
import {
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
  OPEN_GROUP_MAX_PARTICIPANTS,
  SESSION_KIND_OPEN_GROUP_PT,
  SESSION_KIND_STANDARD,
} from "../../../../lib/open-group-pt";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    const rows = db.prepare("SELECT * FROM recurring_classes ORDER BY name ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch recurring classes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name ?? "").trim() || null;
    const instructor = (body.instructor ?? "").trim() || null;
    const duration_minutes = Math.max(1, parseInt(body.duration_minutes, 10) || 60);
    let capacity = Math.max(1, parseInt(body.capacity, 10) || 20);
    const days_of_week = (body.days_of_week ?? "").trim() || "2,4";
    const time = (body.time ?? "").trim() || "18:00";

    const skRaw = String(body.session_kind ?? SESSION_KIND_STANDARD).trim().toLowerCase();
    const session_kind = skRaw === SESSION_KIND_OPEN_GROUP_PT ? SESSION_KIND_OPEN_GROUP_PT : SESSION_KIND_STANDARD;
    if (session_kind === SESSION_KIND_OPEN_GROUP_PT) {
      const rawCap = parseInt(String(body.capacity), 10);
      capacity = Number.isFinite(rawCap) && rawCap > 0 ? Math.min(rawCap, OPEN_GROUP_MAX_PARTICIPANTS) : OPEN_GROUP_MAX_PARTICIPANTS;
    }

    const flat_session_price =
      session_kind === SESSION_KIND_OPEN_GROUP_PT
        ? String(body.flat_session_price ?? "").trim() || OPEN_GROUP_DEFAULT_FLAT_PRICE
        : null;

    if (!name) {
      return NextResponse.json({ error: "Class name required" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);
    const result = db.prepare(`
      INSERT INTO recurring_classes (name, instructor, duration_minutes, capacity, days_of_week, time, session_kind, flat_session_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, instructor, duration_minutes, capacity, days_of_week, time, session_kind, flat_session_price);
    const recurringId = result.lastInsertRowid as number;
    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);
    const dates = getNextOccurrenceDates(days_of_week, time, fromDate, 12);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO class_occurrences (recurring_class_id, occurrence_date, occurrence_time, capacity)
      VALUES (?, ?, ?, ?)
    `);
    for (const { date: occDate, time: occTime } of dates) {
      insertStmt.run(recurringId, occDate, occTime, capacity);
    }
    const row = db.prepare("SELECT * FROM recurring_classes WHERE id = ?").get(recurringId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create recurring class" }, { status: 500 });
  }
}
