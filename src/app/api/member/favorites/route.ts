import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET — list member's favorites with items (food_id, amount, food name). */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const favs = db.prepare("SELECT id, name, created_at FROM member_favorites WHERE member_id = ? ORDER BY name").all(memberId) as { id: number; name: string; created_at: string }[];
    const withItems = favs.map((f) => {
      const items = db.prepare(
        "SELECT fi.id, fi.food_id, fi.amount, fi.sort_order, f.name AS food_name, f.calories, f.protein_g, f.fat_g, f.carbs_g FROM member_favorite_items fi JOIN foods f ON f.id = fi.food_id WHERE fi.member_favorite_id = ? ORDER BY fi.sort_order"
      ).all(f.id) as { id: number; food_id: number; amount: number; sort_order: number; food_name: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null }[];
      return { ...f, items };
    });
    db.close();
    return NextResponse.json(withItems);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list favorites" }, { status: 500 });
  }
}

/**
 * POST — create favorite.
 * Body: { name, items: [ { food_id, amount } ] } — custom list
 *     or { name, meal_id } — copy from a journal meal (member's)
 *     or { name, food_id, amount } — single food
 */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);

    let items: { food_id: number; amount: number }[] = [];

    if (typeof body.meal_id === "number") {
      const entries = db.prepare(
        `SELECT e.food_id, e.amount FROM journal_meal_entries e
         JOIN journal_meals jm ON jm.id = e.journal_meal_id
         JOIN journal_days jd ON jd.id = jm.journal_day_id
         WHERE jm.id = ? AND jd.member_id = ? ORDER BY e.sort_order`
      ).all(body.meal_id, memberId) as { food_id: number; amount: number }[];
      items = entries;
    } else if (typeof body.food_id === "number") {
      const amt = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount ?? 1)) || 1;
      items = [{ food_id: body.food_id, amount: amt }];
    } else if (Array.isArray(body.items)) {
      for (const it of body.items) {
        if (typeof it.food_id === "number" && it.food_id > 0) {
          const amt = typeof it.amount === "number" ? it.amount : parseFloat(String(it.amount ?? 1)) || 1;
          items.push({ food_id: it.food_id, amount: amt });
        }
      }
    }

    if (items.length === 0) {
      db.close();
      return NextResponse.json({ error: "Provide items, meal_id, or food_id+amount" }, { status: 400 });
    }

    const result = db.prepare("INSERT INTO member_favorites (member_id, name) VALUES (?, ?)").run(memberId, name);
    const favId = result.lastInsertRowid as number;
    const insertItem = db.prepare("INSERT INTO member_favorite_items (member_favorite_id, food_id, amount, sort_order) VALUES (?, ?, ?, ?)");
    items.forEach((it, i) => insertItem.run(favId, it.food_id, it.amount, i));
    db.close();
    return NextResponse.json({ id: favId, name, items });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create favorite" }, { status: 500 });
  }
}
