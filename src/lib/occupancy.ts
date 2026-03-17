/**
 * Occupancy (Coconut Count): live members on-site.
 * - KISI unlock → +1 (auto)
 * - Manual +1 for walk-ins (door propped)
 * - Manual -1 is FIFO (remove oldest entry)
 * - Entries auto-expire 1 hour after entry
 */

import { getDb } from "./db";

export function ensureOccupancyTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS occupancy_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entered_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL CHECK (source IN ('kisi', 'manual'))
    );
    CREATE INDEX IF NOT EXISTS idx_occupancy_entered ON occupancy_entries(entered_at);
  `);
}

/** Count entries within the last hour. */
export function getOccupancyCount(db: ReturnType<typeof getDb>): number {
  ensureOccupancyTable(db);
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM occupancy_entries WHERE entered_at > datetime('now', '-1 hour')`
  ).get() as { n: number };
  return row?.n ?? 0;
}

/** Add an entry (+1). Source: 'kisi' (door unlock) or 'manual' (walk-in). enteredAt: optional ISO string (default: now). */
export function addOccupancyEntry(
  db: ReturnType<typeof getDb>,
  source: "kisi" | "manual",
  enteredAt?: string
): void {
  ensureOccupancyTable(db);
  const raw = enteredAt?.trim() || new Date().toISOString();
  const d = new Date(raw);
  const at = Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 19).replace("T", " ")
    : d.toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `INSERT INTO occupancy_entries (entered_at, source) VALUES (?, ?)`
  ).run(at, source);
}

/** Remove oldest entry (-1, FIFO). Returns true if one was removed. */
export function removeOldestOccupancyEntry(db: ReturnType<typeof getDb>): boolean {
  ensureOccupancyTable(db);
  const row = db.prepare(
    `SELECT id FROM occupancy_entries WHERE entered_at > datetime('now', '-1 hour') ORDER BY entered_at ASC LIMIT 1`
  ).get() as { id: number } | undefined;
  if (!row) return false;
  db.prepare(`DELETE FROM occupancy_entries WHERE id = ?`).run(row.id);
  return true;
}

/** Snapshot table for occupancy analytics (charts by day/hour, over time). */
export function ensureOccupancySnapshotsTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS occupancy_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_occupancy_snapshots_recorded ON occupancy_snapshots(recorded_at);
  `);
}

/** Record current occupancy count for analytics. Call from cron every 15 min. */
export function recordOccupancySnapshot(db: ReturnType<typeof getDb>): void {
  ensureOccupancyTable(db);
  ensureOccupancySnapshotsTable(db);
  const count = getOccupancyCount(db);
  const recordedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `INSERT INTO occupancy_snapshots (recorded_at, count) VALUES (?, ?)`
  ).run(recordedAt, count);
}
