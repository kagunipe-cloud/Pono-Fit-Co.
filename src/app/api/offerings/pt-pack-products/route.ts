import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare("SELECT * FROM pt_pack_products ORDER BY duration_minutes ASC, credits ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT pack products" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name ?? "").trim() || null;
    const duration_minutes = [30, 60, 90].includes(Number(body.duration_minutes)) ? Number(body.duration_minutes) : 60;
    const credits = Math.max(1, parseInt(String(body.credits), 10) || 1);
    const price = (body.price ?? "").trim() || null;
    const product_id = (body.product_id ?? "").trim() || randomUUID().slice(0, 8);

    if (!name || !price) {
      return NextResponse.json({ error: "name and price required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    const result = db.prepare(
      "INSERT INTO pt_pack_products (product_id, name, duration_minutes, credits, price) VALUES (?, ?, ?, ?, ?)"
    ).run(product_id, name, duration_minutes, credits, price);
    const row = db.prepare("SELECT * FROM pt_pack_products WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create PT pack product" }, { status: 500 });
  }
}
