/**
 * Trainer clients: links a trainer (member_id) to a client (member_id).
 * When a client books a PT session with a trainer, we ensure they appear in that trainer's "My Clients" list.
 */

import { getDb } from "./db";
import { ensureTrainersTable } from "./trainers";

export function ensureTrainerClientsTable(db: ReturnType<typeof getDb>) {
  ensureTrainersTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trainer_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer_member_id TEXT NOT NULL,
      client_member_id TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(trainer_member_id, client_member_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_trainer_clients_trainer ON trainer_clients(trainer_member_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_trainer_clients_client ON trainer_clients(client_member_id)");
}

/** Resolve trainer display name (e.g. "Jane Doe") to trainer member_id. */
export function getTrainerMemberIdByDisplayName(db: ReturnType<typeof getDb>, displayName: string): string | null {
  const name = displayName.trim();
  if (!name) return null;
  const row = db
    .prepare(
      `SELECT t.member_id
       FROM trainers t
       JOIN members m ON m.member_id = t.member_id
       WHERE TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) = ?`
    )
    .get(name) as { member_id: string } | undefined;
  return row?.member_id ?? null;
}

/** Ensure a client is linked to a trainer (idempotent). Call after a PT booking is created. */
export function ensureTrainerClient(db: ReturnType<typeof getDb>, trainerMemberId: string, clientMemberId: string): void {
  if (!trainerMemberId || !clientMemberId) return;
  ensureTrainerClientsTable(db);
  try {
    db.prepare(
      "INSERT INTO trainer_clients (trainer_member_id, client_member_id) VALUES (?, ?)"
    ).run(trainerMemberId, clientMemberId);
  } catch {
    // ignore unique violation
  }
}
