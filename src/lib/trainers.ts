/**
 * Trainers: gym staff who set availability for PT bookings. Stored as members with role Trainer (or Admin).
 * trainers table holds onboarding docs (waiver, 1099, I-9); exempt if admin.
 */

import { getDb } from "./db";

export function ensureTrainersTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      waiver_agreed_at TEXT,
      form_1099_received_at TEXT,
      form_i9_received_at TEXT,
      exempt_from_tax_forms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_member ON trainers(member_id)");
  } catch {
    /* already exists */
  }
}

export type TrainerRow = {
  id: number;
  member_id: string;
  waiver_agreed_at: string | null;
  form_1099_received_at: string | null;
  form_i9_received_at: string | null;
  exempt_from_tax_forms: number;
  created_at: string | null;
  updated_at: string | null;
};
