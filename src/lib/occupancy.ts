/**
 * Occupancy (Coconut Count): live members on-site.
 * - KISI unlock → +1 (auto)
 * - Manual +1 for walk-ins (door propped)
 * - Manual -1 is FIFO (remove oldest entry)
 * - Entries auto-expire 1 hour after entry
 */

import { getDb } from "./db";

/** Same window as duplicate door taps for analytics "unique check-ins" and occupancy +1 dedupe. */
export const OCCUPANCY_DEDUPE_MINUTES = 60;

export function ensureOccupancyTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS occupancy_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entered_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL CHECK (source IN ('kisi', 'manual'))
    );
    CREATE INDEX IF NOT EXISTS idx_occupancy_entered ON occupancy_entries(entered_at);
  `);
  try {
    db.exec("ALTER TABLE occupancy_entries ADD COLUMN member_id TEXT");
  } catch {
    /* column exists */
  }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_occupancy_member ON occupancy_entries(member_id, entered_at)");
  } catch {
    /* index exists */
  }
}

/** Count entries within the last hour (rolling). Includes Kisi unlocks with or without linked member_id — every +1 row counts. */
export function getOccupancyCount(db: ReturnType<typeof getDb>): number {
  ensureOccupancyTable(db);
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM occupancy_entries
     WHERE entered_at > datetime('now', '-1 hour')`
  ).get() as { n: number };
  return row?.n ?? 0;
}

/** Add an entry (+1). Source: 'kisi' (door unlock) or 'manual' (walk-in). enteredAt: optional ISO string (default: now).
 * memberId: optional — if provided, skips adding if same member has an entry in the last OCCUPANCY_DEDUPE_MINUTES (avoids double-count). */
export function addOccupancyEntry(
  db: ReturnType<typeof getDb>,
  source: "kisi" | "manual",
  enteredAt?: string,
  memberId?: string | null
): void {
  ensureOccupancyTable(db);
  const raw = enteredAt?.trim() || new Date().toISOString();
  const d = new Date(raw);
  const at = Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 19).replace("T", " ")
    : d.toISOString().slice(0, 19).replace("T", " ");
  const mid = memberId?.trim() || null;
  const insertStmt = db.prepare(
    `INSERT INTO occupancy_entries (entered_at, source, member_id) VALUES (?, ?, ?)`
  );
  const checkRecentStmt = db.prepare(
    `SELECT 1 FROM occupancy_entries WHERE member_id = ? AND entered_at > datetime('now', ?) LIMIT 1`
  );
  // BEGIN IMMEDIATE serializes writers so concurrent unlock taps cannot all pass the dedupe check
  // before any insert (check-then-insert race across connections).
  const run = db.transaction(() => {
    if (mid) {
      const recent = checkRecentStmt.get(mid, `-${OCCUPANCY_DEDUPE_MINUTES} minutes`) as { "1"?: number } | undefined;
      if (recent) return;
    }
    insertStmt.run(at, source, mid);
  }).immediate;
  run();
}

/** Remove oldest entry (-1, FIFO) among entries still in the rolling 1h window. Returns true if one was removed. */
export function removeOldestOccupancyEntry(db: ReturnType<typeof getDb>): boolean {
  ensureOccupancyTable(db);
  const row = db.prepare(
    `SELECT id FROM occupancy_entries
     WHERE entered_at > datetime('now', '-1 hour')
     ORDER BY entered_at ASC LIMIT 1`
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
