/**
 * Client goals: one row per client (goal weight, goal body fat %, goal muscle gain).
 * Stored separately from body composition readings.
 */

import type Database from "better-sqlite3";

export function ensureClientGoalsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_goals (
      client_member_id TEXT PRIMARY KEY,
      goal_weight REAL,
      goal_body_fat REAL,
      goal_muscle_gain REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
