import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables, weekStart } from "@/lib/journal";
import { todayInAppTz } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

/** GET ?week=YYYY-MM-DD (Monday) — list journal days for that week. No param = this week. */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const tz = getAppTimezone(db);
    const monday = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? weekParam
      : weekStart(todayInAppTz(tz));
    const start = monday;
    const end = new Date(new Date(start + "T12:00:00Z").getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = db
      .prepare("SELECT id, member_id, date, created_at FROM journal_days WHERE member_id = ? AND date >= ? AND date <= ? ORDER BY date")
      .all(memberId, start, end) as { id: number; member_id: string; date: string; created_at: string }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list days" }, { status: 500 });
  }
}

/** POST — create or get journal day for a date. Body: { date: "YYYY-MM-DD" }. Defaults to today. */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const dateParam = body.date;
    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const tz = getAppTimezone(db);
    const date = typeof dateParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : todayInAppTz(tz);
    const existing = db.prepare("SELECT id, date FROM journal_days WHERE member_id = ? AND date = ?").get(memberId, date) as { id: number; date: string } | undefined;
    if (existing) {
      db.close();
      return NextResponse.json({ id: existing.id, date: existing.date });
    }
    const result = db.prepare("INSERT INTO journal_days (member_id, date) VALUES (?, ?)").run(memberId, date);
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, date });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create day" }, { status: 500 });
  }
}
