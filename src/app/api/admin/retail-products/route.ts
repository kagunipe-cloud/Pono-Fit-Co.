import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  ensureRetailProductsTable,
  normalizeRetailSku,
  getMemberRetailAllowPurchaseWhenOutOfStock,
  getMemberRetailSelfCheckoutEnabled,
  ensureRetailInventoryLedgerTable,
  recordRetailInventoryMovement,
  ensureRetailCategoriesTable,
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

/** GET — categories, product groups (+ variants), standalone products, self-checkout flag */
export async function GET(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  ensureRetailProductsTable(db);
  ensureRetailCategoriesTable(db);
  const member_self_checkout_enabled = getMemberRetailSelfCheckoutEnabled(db);
  const member_allow_purchase_when_out_of_stock = getMemberRetailAllowPurchaseWhenOutOfStock(db);

  const categories = db
    .prepare(`SELECT id, name, sort_order FROM retail_categories ORDER BY sort_order ASC, name COLLATE NOCASE`)
    .all() as { id: number; name: string; sort_order: number }[];

  const groupRows = db
    .prepare(
      `SELECT g.id, g.category_id, g.display_name, g.price, g.unit_cost, g.active, g.created_at,
              c.name AS category_name
       FROM retail_product_groups g
       LEFT JOIN retail_categories c ON c.id = g.category_id
       ORDER BY COALESCE(c.sort_order, 999999), c.name COLLATE NOCASE, g.display_name COLLATE NOCASE`
    )
    .all() as {
      id: number;
      category_id: number | null;
      display_name: string;
      price: string;
      unit_cost: string | null;
      active: number;
      created_at: string | null;
      category_name: string | null;
    }[];

  const groups = groupRows.map((g) => {
    const variants = db
      .prepare(
        `SELECT id, sku, name, stock_quantity, active, created_at FROM retail_products WHERE group_id = ? ORDER BY name COLLATE NOCASE`
      )
      .all(g.id) as {
        id: number;
        sku: string;
        name: string;
        stock_quantity: number;
        active: number;
        created_at: string | null;
      }[];
    return { ...g, variants };
  });

  const standalone_products = db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.price, p.unit_cost, p.stock_quantity, p.active, p.created_at,
              p.category_id, c.name AS category_name
       FROM retail_products p
       LEFT JOIN retail_categories c ON c.id = p.category_id
       WHERE p.group_id IS NULL ORDER BY p.active DESC, p.name COLLATE NOCASE`
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
      category_id: number | null;
      category_name: string | null;
    }[];

  db.close();
  return NextResponse.json({
    categories,
    groups,
    standalone_products,
    products: standalone_products,
    member_self_checkout_enabled,
    member_allow_purchase_when_out_of_stock,
  });
}

/**
 * POST standalone: { sku, name, price, unit_cost?, initial_stock? }
 * POST product group: { kind: "group", display_name, category_id?, price, unit_cost?, variants: [{ sku, name, initial_stock? }] }
 * POST variant: { kind: "variant", group_id, sku, name, initial_stock? }
 */
export async function POST(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const kind = body.kind === "group" ? "group" : body.kind === "variant" ? "variant" : "standalone";

  const adminId = await getAdminMemberId(request);

  if (kind === "group") {
    const display_name = String(body.display_name ?? "").trim();
    const price = parsePriceInput(body.price);
    if (!display_name || !price) {
      return NextResponse.json({ error: "display_name and valid price required" }, { status: 400 });
    }
    const unit_cost =
      body.unit_cost != null && String(body.unit_cost).trim() !== "" ? parsePriceInput(body.unit_cost) : "0.00";
    if (!unit_cost) {
      return NextResponse.json({ error: "Invalid unit_cost" }, { status: 400 });
    }
    let category_id: number | null = null;
    if (body.category_id != null && String(body.category_id).trim() !== "") {
      const cid = parseInt(String(body.category_id), 10);
      if (!Number.isFinite(cid) || cid < 1) {
        return NextResponse.json({ error: "Invalid category_id" }, { status: 400 });
      }
      const db0 = getDb();
      ensureRetailCategoriesTable(db0);
      const cat = db0.prepare("SELECT id FROM retail_categories WHERE id = ?").get(cid) as { id: number } | undefined;
      db0.close();
      if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 400 });
      category_id = cid;
    }

    const rawVariants = Array.isArray(body.variants) ? body.variants : [];
    if (rawVariants.length < 1) {
      return NextResponse.json({ error: "Add at least one variant (SKU + name, e.g. flavor)" }, { status: 400 });
    }

    const db = getDb();
    ensureRetailProductsTable(db);
    try {
      const tx = db.transaction(() => {
        const gr = db
          .prepare(
            "INSERT INTO retail_product_groups (category_id, display_name, price, unit_cost, active) VALUES (?, ?, ?, ?, 1)"
          )
          .run(category_id, display_name, price, unit_cost);
        const gid = Number(gr.lastInsertRowid);
        for (const v of rawVariants) {
          const sku = normalizeRetailSku(v.sku);
          const vname = String(v.name ?? "").trim();
          if (!sku || !vname) {
            throw new Error("VALIDATION: Each variant needs sku and name");
          }
          let initial = 0;
          if (v.initial_stock != null && String(v.initial_stock).trim() !== "") {
            const n = parseInt(String(v.initial_stock), 10);
            if (Number.isNaN(n) || n < 0) throw new Error("VALIDATION: initial_stock must be non-negative integer");
            initial = n;
          }
          const ins = db
            .prepare(
              "INSERT INTO retail_products (sku, name, price, unit_cost, stock_quantity, active, group_id) VALUES (?, ?, ?, ?, ?, 1, ?)"
            )
            .run(sku, vname, price, unit_cost, initial, gid);
          const pid = Number(ins.lastInsertRowid);
          if (initial > 0) {
            ensureRetailInventoryLedgerTable(db);
            recordRetailInventoryMovement(db, {
              retail_product_id: pid,
              delta: initial,
              reason: "receive",
              note: "Initial stock",
              created_by: adminId,
            });
          }
        }
        return gid;
      });
      const gid = tx();
      const group = db
        .prepare(
          `SELECT g.id, g.category_id, g.display_name, g.price, g.unit_cost, g.active, g.created_at,
                  c.name AS category_name
           FROM retail_product_groups g
           LEFT JOIN retail_categories c ON c.id = g.category_id
           WHERE g.id = ?`
        )
        .get(gid) as Record<string, unknown>;
      const variants = db
        .prepare(
          "SELECT id, sku, name, stock_quantity, active FROM retail_products WHERE group_id = ? ORDER BY name COLLATE NOCASE"
        )
        .all(gid);
      db.close();
      return NextResponse.json({ group, variants });
    } catch (e) {
      db.close();
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("VALIDATION:")) {
        return NextResponse.json({ error: msg.replace("VALIDATION: ", "") }, { status: 400 });
      }
      if (msg.toLowerCase().includes("unique")) {
        return NextResponse.json({ error: "A product with this SKU already exists" }, { status: 409 });
      }
      console.error("[admin/retail-products POST group]", e);
      return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
    }
  }

  if (kind === "variant") {
    const group_id = parseInt(String(body.group_id ?? ""), 10);
    if (!Number.isFinite(group_id) || group_id < 1) {
      return NextResponse.json({ error: "group_id required" }, { status: 400 });
    }
    const sku = normalizeRetailSku(body.sku);
    const name = String(body.name ?? "").trim();
    if (!sku || !name) {
      return NextResponse.json({ error: "sku and name required" }, { status: 400 });
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
    const g = db
      .prepare("SELECT id, price, unit_cost FROM retail_product_groups WHERE id = ?")
      .get(group_id) as { id: number; price: string; unit_cost: string | null } | undefined;
    if (!g) {
      db.close();
      return NextResponse.json({ error: "Product group not found" }, { status: 404 });
    }
    const uc = g.unit_cost?.trim() || "0.00";
    try {
      const r = db
        .prepare(
          "INSERT INTO retail_products (sku, name, price, unit_cost, stock_quantity, active, group_id) VALUES (?, ?, ?, ?, ?, 1, ?)"
        )
        .run(sku, name, g.price, uc, initial, group_id);
      const pid = Number(r.lastInsertRowid);
      if (initial > 0) {
        ensureRetailInventoryLedgerTable(db);
        recordRetailInventoryMovement(db, {
          retail_product_id: pid,
          delta: initial,
          reason: "receive",
          note: "Initial stock",
          created_by: adminId,
        });
      }
      const row = db
        .prepare("SELECT id, sku, name, price, unit_cost, stock_quantity, active, group_id FROM retail_products WHERE id = ?")
        .get(pid) as Record<string, unknown>;
      db.close();
      return NextResponse.json(row);
    } catch (e) {
      db.close();
      const msg = e instanceof Error ? e.message : "";
      if (msg.toLowerCase().includes("unique")) {
        return NextResponse.json({ error: "A product with this SKU already exists" }, { status: 409 });
      }
      console.error("[admin/retail-products POST variant]", e);
      return NextResponse.json({ error: "Failed to add variant" }, { status: 500 });
    }
  }

  const sku = normalizeRetailSku(body.sku);
  const name = String(body.name ?? "").trim();
  const price = parsePriceInput(body.price);
  if (!sku || !name || !price) {
    return NextResponse.json({ error: "sku, name, and valid price required" }, { status: 400 });
  }
  const unit_cost =
    body.unit_cost != null && String(body.unit_cost).trim() !== "" ? parsePriceInput(body.unit_cost) : "0.00";
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
  let category_id: number | null = null;
  if (body.category_id != null && String(body.category_id).trim() !== "") {
    const cid = parseInt(String(body.category_id), 10);
    if (!Number.isFinite(cid) || cid < 1) {
      return NextResponse.json({ error: "Invalid category_id" }, { status: 400 });
    }
    ensureRetailCategoriesTable(db);
    const cat = db.prepare("SELECT id FROM retail_categories WHERE id = ?").get(cid) as { id: number } | undefined;
    if (!cat) {
      db.close();
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    category_id = cid;
  }

  try {
    const r = db
      .prepare(
        "INSERT INTO retail_products (sku, name, price, unit_cost, stock_quantity, active, category_id) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
      .run(sku, name, price, unit_cost, initial, category_id);
    const pid = Number(r.lastInsertRowid);
    if (initial > 0) {
      ensureRetailInventoryLedgerTable(db);
      recordRetailInventoryMovement(db, {
        retail_product_id: pid,
        delta: initial,
        reason: "receive",
        note: "Initial stock",
        created_by: adminId,
      });
    }
    const row = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.price, p.unit_cost, p.stock_quantity, p.active, p.category_id, c.name AS category_name
         FROM retail_products p
         LEFT JOIN retail_categories c ON c.id = p.category_id
         WHERE p.id = ?`
      )
      .get(pid) as Record<string, unknown>;
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
