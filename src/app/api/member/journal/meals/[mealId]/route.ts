import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** PATCH — update meal name. Body: { name: string }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mealId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const mealId = parseInt((await params).mealId, 10);
    if (Number.isNaN(mealId)) return NextResponse.json({ error: "Invalid meal id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const meal = db.prepare("SELECT jm.id FROM journal_meals jm JOIN journal_days jd ON jd.id = jm.journal_day_id WHERE jm.id = ? AND jd.member_id = ?").get(mealId, memberId);
    if (!meal) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("UPDATE journal_meals SET name = ? WHERE id = ?").run(name, mealId);
    db.close();
    return NextResponse.json({ id: mealId, name });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update meal" }, { status: 500 });
  }
}

/** DELETE — remove meal and its entries. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ mealId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const mealId = parseInt((await params).mealId, 10);
    if (Number.isNaN(mealId)) return NextResponse.json({ error: "Invalid meal id" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const meal = db.prepare("SELECT jm.id FROM journal_meals jm JOIN journal_days jd ON jd.id = jm.journal_day_id WHERE jm.id = ? AND jd.member_id = ?").get(mealId, memberId);
    if (!meal) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM journal_meals WHERE id = ?").run(mealId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete meal" }, { status: 500 });
  }
}
