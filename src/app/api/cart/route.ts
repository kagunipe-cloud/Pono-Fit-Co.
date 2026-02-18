import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { getMemberIdFromSession } from "../../../lib/session";
import { getAdminMemberId } from "../../../lib/admin";

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

export async function GET(request: NextRequest) {
  const member_id = request.nextUrl.searchParams.get("member_id");
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }
  const sessionMemberId = await getMemberIdFromSession();
  const isAdmin = !!(await getAdminMemberId(request));
  if (sessionMemberId !== member_id && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const db = getDb();
    ensureCartTables(db);

    let cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; member_id: string } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member_id);
      cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; member_id: string };
    }

    const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as { id: number; product_type: string; product_id: number; quantity: number; slot_json?: string | null }[];
    const items: { id: number; product_type: string; product_id: number; quantity: number; name: string; price: string; slot?: { date: string; start_time: string; duration_minutes: number } }[] = [];

    for (const it of rawItems) {
      let name = "—";
      let price = "—";
      if (it.product_type === "membership_plan") {
        const row = db.prepare("SELECT plan_name, price FROM membership_plans WHERE id = ?").get(it.product_id) as { plan_name: string; price: string } | undefined;
        if (row) {
          name = row.plan_name ?? "—";
          price = row.price ?? "—";
        }
      } else if (it.product_type === "pt_session") {
        const row = db.prepare("SELECT session_name, price FROM pt_sessions WHERE id = ?").get(it.product_id) as { session_name: string; price: string } | undefined;
        if (row) {
          name = row.session_name ?? "—";
          price = row.price ?? "—";
        }
      } else if (it.product_type === "class") {
        const row = db.prepare("SELECT class_name, price FROM classes WHERE id = ?").get(it.product_id) as { class_name: string; price: string } | undefined;
        if (row) {
          name = row.class_name ?? "—";
          price = row.price ?? "—";
        }
      }
      let slot: { date: string; start_time: string; duration_minutes: number } | undefined;
      if (it.slot_json) {
        try {
          const parsed = JSON.parse(it.slot_json as string);
          if (parsed?.date && parsed?.start_time != null && typeof parsed.duration_minutes === "number") {
            slot = { date: String(parsed.date), start_time: String(parsed.start_time), duration_minutes: Number(parsed.duration_minutes) };
          }
        } catch {
          /* ignore */
        }
      }
      items.push({ ...it, name, price, ...(slot && { slot }) });
    }

    db.close();
    return NextResponse.json({ cart, items });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}
