import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureRetailProductsTable, normalizeRetailSku } from "@/lib/retail-products";

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
  const existing = db.prepare("SELECT id FROM retail_products WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: string[] = [];
  const vals: (string | number)[] = [];
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

  if (updates.length === 0) {
    db.close();
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    vals.push(id);
    db.prepare(`UPDATE retail_products SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
    const row = db
      .prepare("SELECT id, sku, name, price, unit_cost, stock_quantity, active FROM retail_products WHERE id = ?")
      .get(id) as {
        id: number;
        sku: string;
        name: string;
        price: string;
        unit_cost: string | null;
        stock_quantity: number;
        active: number;
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
