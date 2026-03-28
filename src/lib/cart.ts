import type Database from "better-sqlite3";
import type { getDb } from "./db";

export function ensureCartTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      slot_json TEXT,
      FOREIGN KEY (cart_id) REFERENCES cart(id)
    );
  `);
  try {
    db.exec("ALTER TABLE cart_items ADD COLUMN slot_json TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE cart ADD COLUMN promo_code TEXT");
  } catch {
    /* already exists */
  }
  ensureCartLinePriceOverrides(db);
}

/** Staff-edited line price and (for monthly membership) how long the price applies on auto-renew. */
export function ensureCartLinePriceOverrides(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE cart_items ADD COLUMN unit_price_override TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE cart_items ADD COLUMN price_override_months INTEGER");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE cart_items ADD COLUMN price_override_indefinite INTEGER");
  } catch {
    /* already exists */
  }
}
