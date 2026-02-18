import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM membership_plans ORDER BY id ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const plan_name = (body.plan_name ?? "").trim() || null;
    const price = (body.price ?? "").trim() || null;
    const length = (body.length ?? "").trim() || null;
    const unit = (body.unit ?? "").trim() || null;
    const access_level = (body.access_level ?? "").trim() || null;
    const stripe_link = (body.stripe_link ?? "").trim() || null;
    const category = (body.category ?? "Plans").trim() || "Plans";
    const description = (body.description ?? "").trim() || null;

    const product_id = (body.product_id ?? "").trim() || randomUUID().slice(0, 8);

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO membership_plans (product_id, plan_name, price, length, unit, access_level, stripe_link, category, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(product_id, plan_name, price, length, unit, access_level, stripe_link, category, description);
    const row = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
  }
}
