import { parseAppDateToYMD, weekStartInAppTz as weekStart } from "./app-timezone";

export { weekStart };

/**
 * Daily Food Journal: journal_days (one per member per date), journal_meals (Breakfast, Lunch, etc.),
 * journal_meal_entries (food_id + amount per serving). Member favorites: named food or meal (list of food+amount).
 */

/** Normalize journal weigh-in dates to YYYY-MM-DD for reliable week filtering. */
export function normalizeWeighInDateToIso(dateStr: string): string | null {
  const ymd = parseAppDateToYMD(dateStr);
  if (!ymd) return null;
  const [y, m, d] = ymd;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function repairMemberWeighInDatesIfNeeded(db: ReturnType<typeof import("./db").getDb>): void {
  const bad = db
    .prepare(`SELECT member_id, date, weight FROM member_weigh_ins WHERE date NOT GLOB '????-??-??' LIMIT 1`)
    .get() as { member_id: string; date: string; weight: number } | undefined;
  if (!bad) return;

  const rows = db.prepare("SELECT member_id, date, weight FROM member_weigh_ins").all() as {
    member_id: string;
    date: string;
    weight: number;
  }[];
  for (const row of rows) {
    const iso = normalizeWeighInDateToIso(String(row.date));
    if (!iso || iso === row.date) continue;
    const conflict = db
      .prepare("SELECT weight FROM member_weigh_ins WHERE member_id = ? AND date = ?")
      .get(row.member_id, iso) as { weight: number } | undefined;
    if (conflict) {
      const merged = Math.max(Number(row.weight), Number(conflict.weight));
      db.prepare("UPDATE member_weigh_ins SET weight = ? WHERE member_id = ? AND date = ?").run(merged, row.member_id, iso);
      db.prepare("DELETE FROM member_weigh_ins WHERE member_id = ? AND date = ?").run(row.member_id, row.date);
    } else {
      db.prepare("UPDATE member_weigh_ins SET date = ? WHERE member_id = ? AND date = ?").run(iso, row.member_id, row.date);
    }
  }
}

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
      quantity REAL,
      measurement TEXT,
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

    CREATE TABLE IF NOT EXISTS member_macro_goals (
      member_id TEXT PRIMARY KEY,
      calories_goal INTEGER,
      protein_pct REAL,
      fat_pct REAL,
      carbs_pct REAL
    );
  `);

  const goalCols = db.prepare("PRAGMA table_info(member_macro_goals)").all() as { name: string }[];
  if (goalCols.every((c) => c.name !== "weight_goal")) {
    try {
      db.prepare("ALTER TABLE member_macro_goals ADD COLUMN weight_goal REAL").run();
    } catch {
      /* ignore */
    }
  }
  if (goalCols.every((c) => c.name !== "fiber_goal")) {
    try {
      db.prepare("ALTER TABLE member_macro_goals ADD COLUMN fiber_goal REAL").run();
    } catch {
      /* ignore */
    }
  }

  const dayCols = db.prepare("PRAGMA table_info(journal_days)").all() as { name: string }[];
  if (dayCols.every((c) => c.name !== "macros_finished_at")) {
    try {
      db.prepare("ALTER TABLE journal_days ADD COLUMN macros_finished_at TEXT").run();
    } catch {
      /* ignore */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_weigh_ins (
      member_id TEXT NOT NULL,
      date TEXT NOT NULL,
      weight REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (member_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_member_weigh_ins_member ON member_weigh_ins(member_id);
    CREATE INDEX IF NOT EXISTS idx_member_weigh_ins_date ON member_weigh_ins(member_id, date);
  `);

  repairMemberWeighInDatesIfNeeded(db);
}
