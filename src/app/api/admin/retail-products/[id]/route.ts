import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  ensureRetailCategoriesTable,
  ensureRetailProductsTable,
  normalizeRetailSku,
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

/** PATCH { sku?, name?, price?, active? } — admin. */
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
  ensureRetailProductsTable(db);
  const existing = db
    .prepare("SELECT id, group_id FROM retail_products WHERE id = ?")
    .get(id) as { id: number; group_id: number | null } | undefined;
  if (!existing) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.group_id != null && (body.price != null || body.unit_cost != null)) {
    db.close();
    return NextResponse.json(
      { error: "This SKU is a variant: change price and unit cost on the product group, not the variant row." },
      { status: 400 }
    );
  }

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  if (body.sku != null) {
    const sku = normalizeRetailSku(body.sku);
    if (!sku) {
      db.close();
      return NextResponse.json({ error: "Invalid sku" }, { status: 400 });
    }
    updates.push("sku = ?");
    vals.push(sku);
  }
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) {
      db.close();
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    updates.push("name = ?");
    vals.push(name);
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
  if (body.active != null) {
    const a = body.active === true || body.active === 1 || body.active === "1" ? 1 : 0;
    updates.push("active = ?");
    vals.push(a);
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
  if ("category_id" in body) {
    if (existing.group_id != null) {
      db.close();
      return NextResponse.json(
        { error: "This SKU is a variant: set category on the product group, not the variant row." },
        { status: 400 }
      );
    }
    const rawCat = body.category_id;
    if (rawCat === null || rawCat === "" || rawCat === undefined) {
      updates.push("category_id = NULL");
    } else {
      const cid = parseInt(String(rawCat), 10);
      if (!Number.isFinite(cid) || cid < 1) {
        db.close();
        return NextResponse.json({ error: "Invalid category_id" }, { status: 400 });
      }
      ensureRetailCategoriesTable(db);
      const cat = db.prepare("SELECT id FROM retail_categories WHERE id = ?").get(cid) as { id: number } | undefined;
      if (!cat) {
        db.close();
        return NextResponse.json({ error: "Category not found" }, { status: 400 });
      }
      updates.push("category_id = ?");
      vals.push(cid);
    }
  }

  if (updates.length === 0) {
    db.close();
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    vals.push(id);
    db.prepare(`UPDATE retail_products SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
    const row = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.price, p.unit_cost, p.stock_quantity, p.active, p.group_id,
                p.category_id, c.name AS category_name
         FROM retail_products p
         LEFT JOIN retail_categories c ON c.id = p.category_id
         WHERE p.id = ?`
      )
      .get(id) as {
        id: number;
        sku: string;
        name: string;
        price: string;
        unit_cost: string | null;
        stock_quantity: number;
        active: number;
        group_id: number | null;
        category_id: number | null;
        category_name: string | null;
      };
    db.close();
    return NextResponse.json(row);
  } catch (e) {
    db.close();
    const msg = e instanceof Error ? e.message : "";
    if (msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "A product with this SKU already exists" }, { status: 409 });
    }
    console.error("[admin/retail-products PATCH]", e);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
