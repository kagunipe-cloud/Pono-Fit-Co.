import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    const rows = db.prepare("SELECT * FROM class_pack_products ORDER BY credits ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class packs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name ?? "").trim() || null;
    const credits = Math.max(1, parseInt(body.credits, 10) || 10);
    const price = (body.price ?? "").trim() || null;
    if (!name || !price) {
      return NextResponse.json({ error: "Name and price required" }, { status: 400 });
    }
    const product_id = (body.product_id ?? "").trim() || randomUUID().slice(0, 8);
    const db = getDb();
    ensureRecurringClassesTables(db);
    const result = db.prepare(`
      INSERT INTO class_pack_products (product_id, name, credits, price)
      VALUES (?, ?, ?, ?)
    `).run(product_id, name, credits, price);
    const row = db.prepare("SELECT * FROM class_pack_products WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create class pack" }, { status: 500 });
  }
}
