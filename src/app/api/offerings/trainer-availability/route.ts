import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare("SELECT * FROM trainer_availability ORDER BY day_of_week, start_time").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch trainer availability" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const trainer = (body.trainer ?? "").trim() || null;
    const description = (body.description ?? "").trim() || null;
    const days_of_week_str = (body.days_of_week ?? "").trim() || null;
    let day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 0), 10)));
    if (days_of_week_str) {
      const first = days_of_week_str.split(",").map((d) => parseInt(d.trim(), 10)).find((d) => d >= 0 && d <= 6);
      if (first !== undefined) day_of_week = first;
    }
    const start_time = (body.start_time ?? "09:00").toString().trim();
    const end_time = (body.end_time ?? "17:00").toString().trim();
    if (!trainer) {
      return NextResponse.json({ error: "trainer required" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const result = db.prepare(
      "INSERT INTO trainer_availability (trainer, day_of_week, start_time, end_time, description, days_of_week) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(trainer, day_of_week, start_time, end_time, description, days_of_week_str);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create trainer availability" }, { status: 500 });
  }
}
