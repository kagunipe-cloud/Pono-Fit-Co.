import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const fields = ["product_id", "plan_name", "price", "length", "unit", "access_level", "stripe_link", "category", "description"] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(typeof body[f] === "string" ? body[f].trim() : body[f]);
      }
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    values.push(numericId);
    const db = getDb();
    db.prepare(`UPDATE membership_plans SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    const exists = db.prepare("SELECT 1 FROM membership_plans WHERE id = ?").get(numericId);
    if (!exists) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM membership_plans WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
