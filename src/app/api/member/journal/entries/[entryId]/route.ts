import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** PATCH — update entry amount. Body: { amount: number }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const entryId = parseInt((await params).entryId, 10);
    if (Number.isNaN(entryId)) return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount ?? 1));
    if (Number.isNaN(amount) || amount <= 0) return NextResponse.json({ error: "Valid amount required" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const entry = db.prepare(
      `SELECT e.id FROM journal_meal_entries e
       JOIN journal_meals jm ON jm.id = e.journal_meal_id
       JOIN journal_days jd ON jd.id = jm.journal_day_id
       WHERE e.id = ? AND jd.member_id = ?`
    ).get(entryId, memberId);
    if (!entry) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const cols = db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[];
    const hasDisplayUnits = cols.some((c) => c.name === "quantity") && cols.some((c) => c.name === "measurement");
    if (hasDisplayUnits) {
      db.prepare("UPDATE journal_meal_entries SET amount = ?, quantity = NULL, measurement = NULL WHERE id = ?").run(amount, entryId);
    } else {
      db.prepare("UPDATE journal_meal_entries SET amount = ? WHERE id = ?").run(amount, entryId);
    }
    db.close();
    return NextResponse.json({ id: entryId, amount });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }
}

/** DELETE — remove entry. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const entryId = parseInt((await params).entryId, 10);
    if (Number.isNaN(entryId)) return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const entry = db.prepare(
      `SELECT e.id FROM journal_meal_entries e
       JOIN journal_meals jm ON jm.id = e.journal_meal_id
       JOIN journal_days jd ON jd.id = jm.journal_day_id
       WHERE e.id = ? AND jd.member_id = ?`
    ).get(entryId, memberId);
    if (!entry) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM journal_meal_entries WHERE id = ?").run(entryId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }
}
