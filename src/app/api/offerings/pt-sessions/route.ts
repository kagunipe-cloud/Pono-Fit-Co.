import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { randomUUID } from "crypto";
import { hasClassAtSlot, ptDateTimeToSlot } from "../../../../lib/schedule-conflicts";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** Parse date_time string to { date: YYYY-MM-DD, timeMinutes } or null. Handles "YYYY-MM-DD HH:MM", "M/D/YYYY H:MM", etc. */
function parseDateTime(dt: string | null): { date: string; timeMinutes: number } | null {
  if (!dt || !dt.trim()) return null;
  const s = dt.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{1,2}):(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const timeMinutes = (parseInt(iso[4], 10) % 24) * 60 + (parseInt(iso[5], 10) || 0);
    return { date, timeMinutes };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toISOString().slice(0, 10);
  const timeMinutes = d.getHours() * 60 + d.getMinutes();
  return { date, timeMinutes };
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare("SELECT * FROM pt_sessions ORDER BY id ASC").all() as Record<string, unknown>[];
    db.close();

    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    if (from && to) {
      const filtered = rows.filter((r) => {
        const parsed = parseDateTime(r.date_time as string);
        if (!parsed) return false;
        return parsed.date >= from && parsed.date <= to;
      });
      return NextResponse.json(filtered);
    }
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const session_name = (body.session_name ?? "").trim() || null;
    const session_duration = (body.session_duration ?? "").trim() || null;
    const date_time = (body.date_time ?? "").trim() || null;
    const price = (body.price ?? "").trim() || null;
    const trainer = (body.trainer ?? "").trim() || null;
    const stripe_link = (body.stripe_link ?? "").trim() || null;
    const category = (body.category ?? "PT").trim() || "PT";
    const description = (body.description ?? "").trim() || null;
    const product_id = (body.product_id ?? "").trim() || randomUUID().slice(0, 8);
    let duration_minutes = parseInt(String(body.duration_minutes ?? 60), 10);
    if (![30, 60, 90].includes(duration_minutes)) duration_minutes = 60;

    const db = getDb();
    ensurePTSlotTables(db);
    if (date_time) {
      const slot = ptDateTimeToSlot(date_time);
      if (slot && hasClassAtSlot(db, slot.date, slot.timeMinutes)) {
        db.close();
        return NextResponse.json({ error: "A class is already scheduled at this date and time. Choose a different slot." }, { status: 409 });
      }
    }
    const stmt = db.prepare(`
      INSERT INTO pt_sessions (product_id, session_name, session_duration, date_time, price, trainer, stripe_link, category, description, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(product_id, session_name, session_duration, date_time, price, trainer, stripe_link, category, description, duration_minutes);
    const row = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create PT session" }, { status: 500 });
  }
}
