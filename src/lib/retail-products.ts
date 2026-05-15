import type { getDb } from "./db";

export const MEMBER_RETAIL_SELF_CHECKOUT_KEY = "member_retail_self_checkout";
/** When "1", members may add/pay for retail when on-hand stock is zero or below (trusts restocking). Default "0" = block. */
export const MEMBER_RETAIL_ALLOW_PURCHASE_WHEN_OUT_OF_STOCK_KEY = "member_retail_allow_purchase_when_out_of_stock";

export type RetailInventoryReason =
  | "receive"
  | "shrink"
  | "adjustment"
  | "count"
  | "sale"
  | "refund_restock";

export type RetailLineMeta = {
  id: number;
  sku: string;
  shelf_name: string;
  catalog_price: string;
  unit_cost: string;
  stock_quantity: number;
};

export function ensureRetailCategoriesTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retail_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function ensureRetailProductGroupsTable(db: ReturnType<typeof getDb>) {
  ensureRetailCategoriesTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS retail_product_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      display_name TEXT NOT NULL,
      price TEXT NOT NULL,
      unit_cost TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES retail_categories(id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_retail_groups_category ON retail_product_groups(category_id)");
}

export function ensureRetailProductsTable(db: ReturnType<typeof getDb>) {
  ensureRetailProductGroupsTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS retail_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec("ALTER TABLE retail_products ADD COLUMN unit_cost TEXT");
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE retail_products ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE retail_products ADD COLUMN group_id INTEGER REFERENCES retail_product_groups(id)");
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE retail_products ADD COLUMN category_id INTEGER REFERENCES retail_categories(id)");
  } catch {
    /* exists */
  }
}

export function syncGroupPricesToVariants(db: ReturnType<typeof getDb>, groupId: number): void {
  const g = db.prepare("SELECT price, unit_cost FROM retail_product_groups WHERE id = ?").get(groupId) as
    | { price: string; unit_cost: string | null }
    | undefined;
  if (!g) return;
  const uc = g.unit_cost?.trim() || "0.00";
  db.prepare("UPDATE retail_products SET price = ?, unit_cost = ? WHERE group_id = ?").run(g.price, uc, groupId);
}

/** Sellable retail row: catalog price + display name for receipts, cart, stock errors. */
export function getRetailLineMeta(db: ReturnType<typeof getDb>, productId: number): RetailLineMeta | undefined {
  ensureRetailProductsTable(db);
  const row = db
    .prepare(
      `SELECT p.id, p.sku, p.name AS variant_name, p.stock_quantity, p.active AS product_active,
              p.group_id,
              g.display_name AS group_name, g.price AS group_price, g.unit_cost AS group_unit_cost,
              g.active AS group_active,
              p.price AS row_price, p.unit_cost AS row_unit_cost
       FROM retail_products p
       LEFT JOIN retail_product_groups g ON g.id = p.group_id
       WHERE p.id = ?`
    )
    .get(productId) as
    | {
        id: number;
        sku: string;
        variant_name: string;
        stock_quantity: number;
        product_active: number;
        group_id: number | null;
        group_name: string | null;
        group_price: string | null;
        group_unit_cost: string | null;
        group_active: number | null;
        row_price: string;
        row_unit_cost: string | null;
      }
    | undefined;
  if (!row || row.product_active !== 1) return undefined;
  if (row.group_id != null && row.group_active !== 1) return undefined;
  const grouped = row.group_id != null;
  const shelf_name =
    grouped && row.group_name ? `${row.group_name} — ${row.variant_name}` : row.variant_name;
  const catalog_price = grouped ? row.group_price ?? row.row_price : row.row_price;
  const unit_cost = (grouped ? row.group_unit_cost ?? row.row_unit_cost : row.row_unit_cost) ?? "0.00";
  return {
    id: row.id,
    sku: row.sku,
    shelf_name,
    catalog_price,
    unit_cost,
    stock_quantity: row.stock_quantity,
  };
}

export function ensureRetailInventoryLedgerTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retail_inventory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retail_product_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      reference TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (retail_product_id) REFERENCES retail_products(id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_retail_ledger_product ON retail_inventory_ledger(retail_product_id)");
}

/** Snapshot of retail units sold, used at refund time for optional re-stock. */
export function ensureSaleRetailLinesTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_retail_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_id TEXT NOT NULL,
      retail_product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (retail_product_id) REFERENCES retail_products(id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sale_retail_lines_sales ON sale_retail_lines(sales_id)");
}

export function normalizeRetailSku(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Default off: members use staff / cart only until an admin enables self-checkout. */
export function getMemberRetailSelfCheckoutEnabled(db: ReturnType<typeof getDb>): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(MEMBER_RETAIL_SELF_CHECKOUT_KEY) as
    | { value: string }
    | undefined;
  const v = row?.value?.trim();
  return v === "1" || v === "true" || v === "yes";
}

export function setMemberRetailSelfCheckoutEnabled(db: ReturnType<typeof getDb>, enabled: boolean): void {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    MEMBER_RETAIL_SELF_CHECKOUT_KEY,
    enabled ? "1" : "0"
  );
}

/** When true, member self-checkout may sell retail without positive on-hand quantity. */
export function getMemberRetailAllowPurchaseWhenOutOfStock(db: ReturnType<typeof getDb>): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(MEMBER_RETAIL_ALLOW_PURCHASE_WHEN_OUT_OF_STOCK_KEY) as
    | { value: string }
    | undefined;
  const v = row?.value?.trim();
  return v === "1" || v === "true" || v === "yes";
}

export function setMemberRetailAllowPurchaseWhenOutOfStock(db: ReturnType<typeof getDb>, allowed: boolean): void {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    MEMBER_RETAIL_ALLOW_PURCHASE_WHEN_OUT_OF_STOCK_KEY,
    allowed ? "1" : "0"
  );
}

/** Whether a SKU can be sold from the member Pro Shop catalog (never exposes qty to clients). */
export function retailProductCanPurchaseForMemberCatalog(haveQty: unknown, allowWhenOutOfStock: boolean): boolean {
  const have = Math.max(0, Math.floor(Number(haveQty) || 0));
  if (allowWhenOutOfStock) return true;
  return have > 0;
}

function getRetailLinesQtyByProduct(db: ReturnType<typeof getDb>, cartId: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT product_id, SUM(quantity) AS q FROM cart_items WHERE cart_id = ? AND product_type = 'retail' GROUP BY product_id`
    )
    .all(cartId) as { product_id: number; q: number }[];
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.product_id, Math.max(0, Math.floor(Number(r.q) || 0)));
  }
  return map;
}

/** How many units of this retail SKU are already in the cart (all line items summed). */
export function getRetailInCartQty(db: ReturnType<typeof getDb>, cartId: number, productId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS s FROM cart_items WHERE cart_id = ? AND product_type = 'retail' AND product_id = ?`
    )
    .get(cartId, productId) as { s: number };
  return Math.max(0, Math.floor(Number(row?.s) || 0));
}

/**
 * Ensure every retail line in the cart can be fulfilled from stock.
 * @throws Error with message if any SKU is short.
 */
export function assertRetailStockForCart(db: ReturnType<typeof getDb>, cartId: number, options?: { skipRetailStock?: boolean }): void {
  if (options?.skipRetailStock) return;
  ensureRetailProductsTable(db);
  const want = getRetailLinesQtyByProduct(db, cartId);
  for (const [productId, need] of want) {
    if (need <= 0) continue;
    const meta = getRetailLineMeta(db, productId);
    if (!meta) {
      throw new Error("A retail item in the cart is no longer available. Remove it and try again.");
    }
    const have = Math.max(0, Math.floor(Number(meta.stock_quantity) || 0));
    if (have < need) {
      throw new Error(`Not enough stock for ${meta.shelf_name} (have ${have}, need ${need} in cart).`);
    }
  }
}

export function recordRetailInventoryMovement(
  db: ReturnType<typeof getDb>,
  args: {
    retail_product_id: number;
    delta: number;
    reason: RetailInventoryReason;
    note?: string | null;
    reference?: string | null;
    created_by?: string | null;
  }
): void {
  ensureRetailInventoryLedgerTable(db);
  db.prepare(
    `INSERT INTO retail_inventory_ledger (retail_product_id, delta, reason, note, reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    args.retail_product_id,
    args.delta,
    args.reason,
    args.note?.trim() || null,
    args.reference?.trim() || null,
    args.created_by?.trim() || null
  );
}
