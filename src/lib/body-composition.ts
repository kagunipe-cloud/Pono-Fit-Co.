/**
 * Body composition: one row per client per date, matching docs/Body-Comp-Sample.csv.
 * Hydration % can be computed as (tbw / weight) * 100 when not provided.
 */

import type Database from "better-sqlite3";

export function ensureBodyCompositionTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_body_composition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_member_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      body_type TEXT,
      gender TEXT,
      age INTEGER,
      height TEXT,
      weight REAL,
      bmi REAL,
      fat_pct REAL,
      bmr INTEGER,
      impedance INTEGER,
      fat_mass REAL,
      ffm REAL,
      tbw REAL,
      hydration_pct REAL,
      goal_weight REAL,
      goal_body_fat REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_body_comp_client ON client_body_composition(client_member_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_body_comp_recorded ON client_body_composition(client_member_id, recorded_at)");
}
