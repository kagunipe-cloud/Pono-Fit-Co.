import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** POST — add a meal/snack to the day. Body: { name: string }. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const date = (await params).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "Meal").trim() || "Meal";

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const day = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(memberId, date) as { id: number } | undefined;
    if (!day) {
      db.close();
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }
    const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM journal_meals WHERE journal_day_id = ?").get(day.id) as { m: number };
    const sort_order = (maxOrder?.m ?? -1) + 1;
    const result = db.prepare("INSERT INTO journal_meals (journal_day_id, name, sort_order) VALUES (?, ?, ?)").run(day.id, name, sort_order);
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, journal_day_id: day.id, name, sort_order });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add meal" }, { status: 500 });
  }
}
