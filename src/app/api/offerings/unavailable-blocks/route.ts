import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getUnavailableInRange } from "../../../../lib/pt-availability";

export const dynamic = "force-dynamic";

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — Returns expanded unavailable occurrences in range.
 * GET (no params) — Returns raw unavailable_blocks rows (for listing).
 */
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    if (from && to) {
      const occurrences = getUnavailableInRange(from, to);
      return NextResponse.json(occurrences);
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare("SELECT * FROM unavailable_blocks ORDER BY day_of_week, start_time").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch unavailable blocks" }, { status: 500 });
  }
}

/** POST { trainer?: string, day_of_week: number, start_time, end_time, description } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const trainer = (body.trainer ?? "").trim();
    const day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 0), 10)));
    const start_time = (body.start_time ?? "12:00").toString().trim();
    const end_time = (body.end_time ?? "13:00").toString().trim();
    const description = (body.description ?? "").trim() || "Unavailable";
    const db = getDb();
    ensurePTSlotTables(db);
    const result = db.prepare(
      "INSERT INTO unavailable_blocks (trainer, day_of_week, start_time, end_time, description) VALUES (?, ?, ?, ?, ?)"
    ).run(trainer, day_of_week, start_time, end_time, description);
    const row = db.prepare("SELECT * FROM unavailable_blocks WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create unavailable block" }, { status: 500 });
  }
}
