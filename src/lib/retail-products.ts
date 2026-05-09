import type { getDb } from "./db";

export const MEMBER_RETAIL_SELF_CHECKOUT_KEY = "member_retail_self_checkout";

export type RetailInventoryReason =
  | "receive"
  | "shrink"
  | "adjustment"
  | "count"
  | "sale"
  | "refund_restock";

export function ensureRetailProductsTable(db: ReturnType<typeof getDb>) {
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
export function assertRetailStockForCart(db: ReturnType<typeof getDb>, cartId: number): void {
  ensureRetailProductsTable(db);
  const want = getRetailLinesQtyByProduct(db, cartId);
  for (const [productId, need] of want) {
    if (need <= 0) continue;
    const p = db
      .prepare("SELECT name, stock_quantity FROM retail_products WHERE id = ? AND active = 1")
      .get(productId) as { name: string; stock_quantity: number } | undefined;
    if (!p) {
      throw new Error("A retail item in the cart is no longer available. Remove it and try again.");
    }
    const have = Math.max(0, Math.floor(Number(p.stock_quantity) || 0));
    if (have < need) {
      throw new Error(`Not enough stock for ${p.name} (have ${have}, need ${need} in cart).`);
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
