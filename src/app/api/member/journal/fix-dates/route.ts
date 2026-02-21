import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureJournalTables } from "@/lib/journal";
import { dateStringInAppTz } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

/**
 * POST — one-time fix: reassign journal days to the date they were created in Hawaiian time.
 * Use after switching "today" to Hawaiian time so past entries show on the correct day.
 * Returns { updated, merged, details }.
 */
export async function POST() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureJournalTables(db);

    const rows = db.prepare(
      "SELECT id, date, created_at FROM journal_days WHERE member_id = ? ORDER BY date"
    ).all(memberId) as { id: number; date: string; created_at: string }[];

    let updated = 0;
    let merged = 0;
    const details: { dayId: number; from: string; to: string; action: "updated" | "merged" }[] = [];

    for (const row of rows) {
      const createdAt = row.created_at ?? "";
      const hawaiianDate = dateStringInAppTz(createdAt);
      if (!hawaiianDate || hawaiianDate === row.date) continue;

      const existing = db.prepare(
        "SELECT id FROM journal_days WHERE member_id = ? AND date = ?"
      ).get(memberId, hawaiianDate) as { id: number } | undefined;

      if (!existing) {
        db.prepare("UPDATE journal_days SET date = ? WHERE id = ?").run(hawaiianDate, row.id);
        updated++;
        details.push({ dayId: row.id, from: row.date, to: hawaiianDate, action: "updated" });
      } else {
        db.prepare("UPDATE journal_meals SET journal_day_id = ? WHERE journal_day_id = ?")
          .run(existing.id, row.id);
        db.prepare("DELETE FROM journal_days WHERE id = ?").run(row.id);
        merged++;
        details.push({ dayId: row.id, from: row.date, to: hawaiianDate, action: "merged" });
      }
    }

    db.close();
    return NextResponse.json({ updated, merged, details });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fix dates" }, { status: 500 });
  }
}
