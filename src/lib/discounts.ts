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
}
