/**
 * Daily Food Journal: journal_days (one per member per date), journal_meals (Breakfast, Lunch, etc.),
 * journal_meal_entries (food_id + amount per serving). Member favorites: named food or meal (list of food+amount).
 */

export function ensureJournalTables(db: ReturnType<typeof import("./db").getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(member_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_days_member ON journal_days(member_id);
    CREATE INDEX IF NOT EXISTS idx_journal_days_date ON journal_days(member_id, date);

    CREATE TABLE IF NOT EXISTS journal_meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_day_id INTEGER NOT NULL REFERENCES journal_days(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_journal_meals_day ON journal_meals(journal_day_id);

    CREATE TABLE IF NOT EXISTS journal_meal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_meal_id INTEGER NOT NULL REFERENCES journal_meals(id) ON DELETE CASCADE,
      food_id INTEGER NOT NULL REFERENCES foods(id),
      amount REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_journal_meal_entries_meal ON journal_meal_entries(journal_meal_id);
  `);

  const entryCols = db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[];
  for (const col of ["quantity", "measurement"]) {
    if (entryCols.some((c) => c.name === col)) continue;
    try {
      db.prepare(`ALTER TABLE journal_meal_entries ADD COLUMN ${col} ${col === "measurement" ? "TEXT" : "REAL"}`).run();
    } catch {
      /* ignore */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_member_favorites_member ON member_favorites(member_id);

    CREATE TABLE IF NOT EXISTS member_favorite_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_favorite_id INTEGER NOT NULL REFERENCES member_favorites(id) ON DELETE CASCADE,
      food_id INTEGER NOT NULL REFERENCES foods(id),
      amount REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_member_favorite_items_fav ON member_favorite_items(member_favorite_id);
  `);
}

/** Monday of the week containing date (YYYY-MM-DD). */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}
