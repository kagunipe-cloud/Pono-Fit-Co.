/**
 * PT: trainer availability blocks, block bookings (30/60/90 min with reserve rules), and credits.
 */

import { getDb } from "./db";

export const PT_DURATIONS = [30, 60, 90] as const;
export type PTDuration = (typeof PT_DURATIONS)[number];

/** Reserve minutes when booking: 30→45, 60→75, 90→120. If only exact time left in block, use exact. */
export const RESERVE_MINUTES: Record<number, number> = { 30: 45, 60: 75, 90: 120 };

export function timeToMinutes(t: string): number {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  return ((parts[0] ?? 0) % 24) * 60 + (parts[1] ?? 0);
}

export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

/** For a session of `duration` min, return reserved minutes: 45/75/120, or exact if `remainingMinutes` equals 30/60/90. */
export function reservedMinutes(duration: number, remainingMinutes: number): number {
  const reserve = RESERVE_MINUTES[duration] ?? duration;
  if (duration === 30 && remainingMinutes === 30) return 30;
  if (duration === 60 && remainingMinutes === 60) return 60;
  if (duration === 90 && remainingMinutes === 90) return 90;
  return reserve;
}

export function ensurePTSlotTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pt_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT,
      session_name TEXT,
      session_duration TEXT,
      date_time TEXT,
      price TEXT,
      trainer TEXT,
      stripe_link TEXT,
      category TEXT,
      description TEXT,
      duration_minutes INTEGER DEFAULT 60
    );
  `);
  try {
    db.exec("ALTER TABLE pt_sessions ADD COLUMN duration_minutes INTEGER DEFAULT 60");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE pt_sessions ADD COLUMN image_url TEXT");
  } catch {
    /* already exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS trainer_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec("ALTER TABLE trainer_availability ADD COLUMN description TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE trainer_availability ADD COLUMN days_of_week TEXT");
  } catch {
    /* already exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pt_block_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer_availability_id INTEGER NOT NULL,
      occurrence_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      session_duration_minutes INTEGER NOT NULL,
      reserved_minutes INTEGER NOT NULL,
      member_id TEXT NOT NULL,
      payment_type TEXT NOT NULL DEFAULT 'paid',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (trainer_availability_id) REFERENCES trainer_availability(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pt_block_bookings_avail ON pt_block_bookings(trainer_availability_id, occurrence_date);
    CREATE INDEX IF NOT EXISTS idx_pt_block_bookings_member ON pt_block_bookings(member_id);
    CREATE TABLE IF NOT EXISTS pt_slot_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pt_session_id INTEGER NOT NULL UNIQUE,
      member_id TEXT NOT NULL,
      payment_type TEXT NOT NULL DEFAULT 'paid',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pt_session_id) REFERENCES pt_sessions(id)
    );
    CREATE TABLE IF NOT EXISTS pt_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pt_pack_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      price TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pt_slot_bookings_session ON pt_slot_bookings(pt_session_id);
    CREATE INDEX IF NOT EXISTS idx_pt_slot_bookings_member ON pt_slot_bookings(member_id);
    CREATE INDEX IF NOT EXISTS idx_pt_credit_ledger_member ON pt_credit_ledger(member_id);
    CREATE TABLE IF NOT EXISTS unavailable_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer TEXT NOT NULL DEFAULT '',
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_unavailable_blocks_day ON unavailable_blocks(day_of_week);
    CREATE TABLE IF NOT EXISTS pt_open_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      occurrence_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      pt_session_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL DEFAULT 'paid',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pt_session_id) REFERENCES pt_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pt_open_bookings_date ON pt_open_bookings(occurrence_date);
    CREATE INDEX IF NOT EXISTS idx_pt_open_bookings_member ON pt_open_bookings(member_id);
  `);
  try {
    db.exec("ALTER TABLE pt_open_bookings ADD COLUMN guest_name TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE pt_open_bookings ADD COLUMN credit_docked INTEGER DEFAULT 0");
  } catch {
    /* already exists */
  }
}

export function getPTCreditBalance(db: ReturnType<typeof getDb>, member_id: string, duration_minutes: number): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS balance FROM pt_credit_ledger WHERE member_id = ? AND duration_minutes = ?"
  ).get(member_id, duration_minutes) as { balance: number };
  return Number(row?.balance ?? 0);
}

export function getPTCreditBalances(db: ReturnType<typeof getDb>, member_id: string): Record<number, number> {
  const rows = db.prepare(
    "SELECT duration_minutes, SUM(amount) AS balance FROM pt_credit_ledger WHERE member_id = ? GROUP BY duration_minutes"
  ).all(member_id) as { duration_minutes: number; balance: number }[];
  const out: Record<number, number> = { 30: 0, 60: 0, 90: 0 };
  for (const r of rows) out[r.duration_minutes] = Number(r.balance ?? 0);
  return out;
}
