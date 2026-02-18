import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

function ensureCartTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      slot_json TEXT,
      FOREIGN KEY (cart_id) REFERENCES cart(id)
    );
  `);
  try {
    db.exec("ALTER TABLE cart_items ADD COLUMN slot_json TEXT");
  } catch {
    /* already exists */
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const product_type = (body.product_type ?? "").trim();
    const product_id = parseInt(String(body.product_id), 10);
    const quantity = Math.max(1, parseInt(String(body.quantity), 10) || 1);

    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    if (sessionMemberId !== member_id && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!member_id || !product_type || Number.isNaN(product_id)) {
      return NextResponse.json({ error: "member_id, product_type, product_id required" }, { status: 400 });
    }
    if (!["membership_plan", "pt_session", "class", "class_pack", "class_occurrence", "pt_pack"].includes(product_type)) {
      return NextResponse.json({ error: "product_type must be membership_plan, pt_session, class, class_pack, class_occurrence, or pt_pack" }, { status: 400 });
    }

    const slot = body.slot;
    const slot_json =
      product_type === "pt_session" && slot && typeof slot === "object" && slot.date && slot.start_time && slot.duration_minutes
        ? JSON.stringify({ date: String(slot.date), start_time: String(slot.start_time), duration_minutes: Number(slot.duration_minutes) })
        : null;

    const db = getDb();
    ensureCartTables(db);

    let cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member_id);
      cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number };
    }

    db.prepare("INSERT INTO cart_items (cart_id, product_type, product_id, quantity, slot_json) VALUES (?, ?, ?, ?, ?)").run(
      cart.id,
      product_type,
      product_id,
      quantity,
      slot_json
    );
    const row = db.prepare("SELECT * FROM cart_items WHERE cart_id = ? ORDER BY id DESC LIMIT 1").get(cart.id);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add to cart" }, { status: 500 });
  }
}
