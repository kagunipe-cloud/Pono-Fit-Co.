import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables, weekStart } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET — list weeks (Monday dates) that have at least one journal day for the member. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const rows = db
      .prepare("SELECT DISTINCT date FROM journal_days WHERE member_id = ? ORDER BY date DESC LIMIT 100")
      .all(memberId) as { date: string }[];
    const weekStarts = [...new Set(rows.map((r) => weekStart(r.date)))].sort().reverse();
    db.close();
    return NextResponse.json(weekStarts);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list weeks" }, { status: 500 });
  }
}
