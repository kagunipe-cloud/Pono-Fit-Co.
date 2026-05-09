import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  ensureRetailProductGroupsTable,
  syncGroupPricesToVariants,
} from "@/lib/retail-products";

export const dynamic = "force-dynamic";

function parsePriceInput(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n) || n < 0) return null;
  return n.toFixed(2);
}

/** PATCH { display_name?, category_id?, price?, unit_cost?, active? } — category_id null clears category */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  ensureRetailProductGroupsTable(db);
  const existing = db.prepare("SELECT id FROM retail_product_groups WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];

  if (body.display_name != null) {
    const display_name = String(body.display_name).trim();
    if (!display_name) {
      db.close();
      return NextResponse.json({ error: "Invalid display_name" }, { status: 400 });
    }
    updates.push("display_name = ?");
    vals.push(display_name);
  }
  if (body.category_id !== undefined) {
    if (body.category_id === null || body.category_id === "") {
      updates.push("category_id = NULL");
    } else {
      const cid = parseInt(String(body.category_id), 10);
      if (!Number.isFinite(cid) || cid < 1) {
        db.close();
        return NextResponse.json({ error: "Invalid category_id" }, { status: 400 });
      }
      const cat = db.prepare("SELECT id FROM retail_categories WHERE id = ?").get(cid) as { id: number } | undefined;
      if (!cat) {
        db.close();
        return NextResponse.json({ error: "Category not found" }, { status: 400 });
      }
      updates.push("category_id = ?");
      vals.push(cid);
    }
  }
  if (body.price != null) {
    const price = parsePriceInput(body.price);
    if (!price) {
      db.close();
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }
    updates.push("price = ?");
    vals.push(price);
  }
  if (body.unit_cost != null) {
    const raw = String(body.unit_cost).trim();
    const uc = raw === "" ? "0.00" : parsePriceInput(body.unit_cost);
    if (!uc) {
      db.close();
      return NextResponse.json({ error: "Invalid unit_cost" }, { status: 400 });
    }
    updates.push("unit_cost = ?");
    vals.push(uc);
  }
  if (body.active != null) {
    const a = body.active === true || body.active === 1 || body.active === "1" ? 1 : 0;
    updates.push("active = ?");
    vals.push(a);
  }

  if (updates.length === 0) {
    db.close();
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(id);
  db.prepare(`UPDATE retail_product_groups SET ${updates.join(", ")} WHERE id = ?`).run(...vals);

  syncGroupPricesToVariants(db, id);

  const row = db
    .prepare(
      `SELECT g.id, g.category_id, g.display_name, g.price, g.unit_cost, g.active, g.created_at,
              c.name AS category_name
       FROM retail_product_groups g
       LEFT JOIN retail_categories c ON c.id = g.category_id
       WHERE g.id = ?`
    )
    .get(id) as {
      id: number;
      category_id: number | null;
      display_name: string;
      price: string;
      unit_cost: string | null;
      active: number;
      created_at: string | null;
      category_name: string | null;
    };
  db.close();
  return NextResponse.json(row);
}
