/**
 * Usage tracking: door access (Kisi webhooks) and app usage (member actions/page views).
 */

import { getDb } from "./db";

export function ensureUsageTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS door_access_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      member_id TEXT,
      kisi_actor_id INTEGER,
      kisi_actor_name TEXT,
      lock_id INTEGER,
      lock_name TEXT,
      success INTEGER NOT NULL,
      happened_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_door_access_member ON door_access_events(member_id);
    CREATE INDEX IF NOT EXISTS idx_door_access_happened ON door_access_events(happened_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_app_usage_member ON app_usage_events(member_id);
    CREATE INDEX IF NOT EXISTS idx_app_usage_created ON app_usage_events(created_at);
  `);
}
