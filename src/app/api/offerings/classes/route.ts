import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { randomUUID } from "crypto";
import { hasPTAtSlot, classDateTimeToMinutes } from "../../../../lib/schedule-conflicts";
import { ensureRecurringClassesTables, getNextOccurrenceDates } from "../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM classes ORDER BY id ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch classes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const class_name = (body.class_name ?? "").trim() || null;
    const instructor = (body.instructor ?? "").trim() || null;
    const date = (body.date ?? "").trim() || null;
    const time = (body.time ?? "").trim() || null;
    const capacity = (body.capacity ?? "").trim() || null;
    const status = (body.status ?? "Open").trim() || "Open";
    const price = (body.price ?? "").trim() || null;
    const stripe_link = (body.stripe_link ?? "").trim() || null;
    const category = (body.category ?? "Classes").trim() || "Classes";
    const description = (body.description ?? "").trim() || null;
    const image_url = (body.image_url ?? "").trim() || null;
    const product_id = (body.product_id ?? "").trim() || randomUUID().slice(0, 8);
    const is_recurring = body.is_recurring ? 1 : 0;
    const days_of_week = (body.days_of_week ?? "").trim() || null;
    const duration_minutes = Math.min(240, Math.max(15, parseInt(String(body.duration_minutes ?? 60), 10) || 60));

    const db = getDb();
    if (!is_recurring && date && time) {
      const timeMinutes = classDateTimeToMinutes(date, time);
      if (hasPTAtSlot(db, date, timeMinutes)) {
        db.close();
        return NextResponse.json({ error: "A PT session is already scheduled at this date and time. Choose a different slot." }, { status: 409 });
      }
    }
    try {
      db.exec("ALTER TABLE classes ADD COLUMN is_recurring INTEGER DEFAULT 0");
    } catch {
      /* already exists */
    }
    try {
      db.exec("ALTER TABLE classes ADD COLUMN days_of_week TEXT");
    } catch {
      /* already exists */
    }
    ensureRecurringClassesTables(db);
    const stmt = db.prepare(`
      INSERT INTO classes (product_id, class_name, instructor, date, time, capacity, status, price, stripe_link, category, description, image_url, is_recurring, days_of_week, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(product_id, class_name, instructor, date, time, capacity, status, price, stripe_link, category, description, image_url, is_recurring, days_of_week, duration_minutes);
    const classId = result.lastInsertRowid as number;
    if (!is_recurring && date && time) {
      const cap = capacity != null && capacity !== "" ? parseInt(String(capacity), 10) || 20 : 20;
      try {
        db.prepare("INSERT INTO class_occurrences (class_id, occurrence_date, occurrence_time, capacity) VALUES (?, ?, ?, ?)").run(classId, date, time, cap);
      } catch (e) {
        db.close();
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Create one-off class occurrence:", e);
        return NextResponse.json({ error: `Class created but schedule occurrence failed: ${msg}` }, { status: 500 });
      }
    }
    if (is_recurring && days_of_week) {
      const fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
      const timeStr = (time ?? "18:00").toString().trim();
      const dates = getNextOccurrenceDates(days_of_week, timeStr, fromDate, 12);
      const cap = capacity != null && capacity !== "" ? parseInt(String(capacity), 10) || 20 : 20;
      const timePart = (t: string) => {
        const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
        return ((parts[0] ?? 0) % 24) * 60 + (parts[1] ?? 0);
      };
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO class_occurrences (class_id, occurrence_date, occurrence_time, capacity)
        VALUES (?, ?, ?, ?)
      `);
      for (const { date: occDate, time: occTime } of dates) {
        if (hasPTAtSlot(db, occDate, timePart(occTime))) continue;
        insertStmt.run(classId, occDate, occTime, cap);
      }
    }
    const row = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create class" }, { status: 500 });
  }
}
