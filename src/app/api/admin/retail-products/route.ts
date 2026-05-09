import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureRetailProductsTable, normalizeRetailSku, getMemberRetailSelfCheckoutEnabled, ensureRetailInventoryLedgerTable, recordRetailInventoryMovement } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

function parsePriceInput(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n) || n < 0) return null;
  return n.toFixed(2);
}

/** GET — all retail rows + member self-checkout flag (admin). */
export async function GET(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  ensureRetailProductsTable(db);
  const member_self_checkout_enabled = getMemberRetailSelfCheckoutEnabled(db);
  const rows = db
    .prepare(
      `SELECT id, sku, name, price, unit_cost, stock_quantity, active, created_at
       FROM retail_products ORDER BY active DESC, name COLLATE NOCASE`
    )
    .all() as {
      id: number;
      sku: string;
      name: string;
      price: string;
      unit_cost: string | null;
      stock_quantity: number;
      active: number;
      created_at: string | null;
    }[];
  db.close();
  return NextResponse.json({ products: rows, member_self_checkout_enabled });
}

/** POST { sku, name, price, unit_cost?, initial_stock? } — create (admin). */
export async function POST(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const sku = normalizeRetailSku(body.sku);
  const name = String(body.name ?? "").trim();
  const price = parsePriceInput(body.price);
  if (!sku || !name || !price) {
    return NextResponse.json({ error: "sku, name, and valid price required" }, { status: 400 });
  }
  const unit_cost = body.unit_cost != null && String(body.unit_cost).trim() !== "" ? parsePriceInput(body.unit_cost) : "0.00";
  if (!unit_cost) {
    return NextResponse.json({ error: "Invalid unit_cost" }, { status: 400 });
  }
  let initial = 0;
  if (body.initial_stock != null && String(body.initial_stock).trim() !== "") {
    const n = parseInt(String(body.initial_stock), 10);
    if (Number.isNaN(n) || n < 0) {
      return NextResponse.json({ error: "initial_stock must be a non-negative integer" }, { status: 400 });
    }
    initial = n;
  }

  const db = getDb();
  ensureRetailProductsTable(db);
  try {
    const r = db
      .prepare("INSERT INTO retail_products (sku, name, price, unit_cost, stock_quantity, active) VALUES (?, ?, ?, ?, ?, 1)")
      .run(sku, name, price, unit_cost, initial);
    const pid = Number(r.lastInsertRowid);
    if (initial > 0) {
      ensureRetailInventoryLedgerTable(db);
      const adminId = await getAdminMemberId(request);
      recordRetailInventoryMovement(db, {
        retail_product_id: pid,
        delta: initial,
        reason: "receive",
        note: "Initial stock",
        created_by: adminId,
      });
    }
    const row = db
      .prepare("SELECT id, sku, name, price, unit_cost, stock_quantity, active FROM retail_products WHERE id = ?")
      .get(pid) as {
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
    console.error("[admin/retail-products POST]", e);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
