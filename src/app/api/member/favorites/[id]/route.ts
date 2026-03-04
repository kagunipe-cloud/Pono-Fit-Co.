import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** PATCH — update favorite name and/or items. Body: { name?: string, items?: [{ food_id, amount }] }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const items = Array.isArray(body.items)
      ? body.items
          .filter((it: unknown) => typeof (it as { food_id?: unknown }).food_id === "number" && (it as { food_id: number }).food_id > 0)
          .map((it: { food_id: number; amount?: number }) => ({
            food_id: (it as { food_id: number }).food_id,
            amount: typeof (it as { amount?: number }).amount === "number" ? (it as { amount: number }).amount : parseFloat(String((it as { amount?: unknown }).amount ?? 1)) || 1,
          }))
      : null;

    const db = getDb();
    ensureJournalTables(db);
    ensureFoodsTable(db);
    const row = db.prepare("SELECT id FROM member_favorites WHERE id = ? AND member_id = ?").get(id, memberId) as { id: number } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (name != null && name !== "") {
      db.prepare("UPDATE member_favorites SET name = ? WHERE id = ?").run(name, id);
    }
    if (items != null) {
      db.prepare("DELETE FROM member_favorite_items WHERE member_favorite_id = ?").run(id);
      const insertItem = db.prepare("INSERT INTO member_favorite_items (member_favorite_id, food_id, amount, sort_order) VALUES (?, ?, ?, ?)");
      items.forEach((it: { food_id: number; amount: number }, i: number) => insertItem.run(id, it.food_id, it.amount, i));
    }

    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update favorite" }, { status: 500 });
  }
}

/** DELETE — remove favorite. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const row = db.prepare("SELECT id FROM member_favorites WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM member_favorites WHERE id = ?").run(id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete favorite" }, { status: 500 });
  }
}
