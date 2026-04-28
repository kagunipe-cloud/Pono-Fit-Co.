import type Database from "better-sqlite3";

export function ensureDiscountsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      percent_off INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      scope TEXT DEFAULT 'cart',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const cols = db.prepare("PRAGMA table_info(discounts)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "applies_to_renewals")) {
    try {
      db.exec("ALTER TABLE discounts ADD COLUMN applies_to_renewals INTEGER NOT NULL DEFAULT 0");
    } catch {
      /* ignore */
    }
  }
}

/** When a promo is marked for renewals, this is stored on monthly subscriptions as `renewal_discount_percent`. */
export function getRenewalDiscountPercentForPromo(db: Database.Database, promoCode: string | null | undefined): number | null {
  const p = promoCode?.trim();
  if (!p) return null;
  const row = db
    .prepare(
      "SELECT percent_off, COALESCE(applies_to_renewals, 0) AS ar FROM discounts WHERE UPPER(TRIM(code)) = ?"
    )
    .get(p.toUpperCase()) as { percent_off: number; ar: number } | undefined;
  if (!row || row.ar !== 1) return null;
  return Math.min(100, Math.max(0, row.percent_off));
}
