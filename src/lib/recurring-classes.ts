/**
 * Schema and helpers for class occurrences (from classes or legacy recurring_classes), class packs, and credit-based booking.
 */

import { getDb } from "./db";

/** Add is_recurring and days_of_week to classes if missing. */
export function ensureClassesRecurringColumns(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE classes ADD COLUMN is_recurring INTEGER DEFAULT 0");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE classes ADD COLUMN days_of_week TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE classes ADD COLUMN trainer_member_id TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE classes ADD COLUMN duration_minutes INTEGER DEFAULT 60");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE classes ADD COLUMN image_url TEXT");
  } catch {
    /* already exists */
  }
}

/** Add class_id to class_occurrences if missing (occurrences can come from classes.id). */
export function ensureClassOccurrencesClassId(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE class_occurrences ADD COLUMN class_id INTEGER REFERENCES classes(id)");
  } catch {
    /* already exists */
  }
}

export function ensureRecurringClassesTables(db: ReturnType<typeof getDb>) {
  ensureClassesRecurringColumns(db);
  ensureClassOccurrencesClassId(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      instructor TEXT,
      duration_minutes INTEGER DEFAULT 60,
      capacity INTEGER DEFAULT 20,
      days_of_week TEXT NOT NULL,
      time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS class_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recurring_class_id INTEGER,
      class_id INTEGER,
      occurrence_date TEXT NOT NULL,
      occurrence_time TEXT NOT NULL,
      capacity INTEGER,
      UNIQUE(recurring_class_id, occurrence_date),
      FOREIGN KEY (recurring_class_id) REFERENCES recurring_classes(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_class_occurrences_class_date ON class_occurrences(class_id, occurrence_date) WHERE class_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS class_pack_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL,
      price TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS class_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS occurrence_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      class_occurrence_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (class_occurrence_id) REFERENCES class_occurrences(id),
      UNIQUE(member_id, class_occurrence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_occurrence_date ON class_occurrences(occurrence_date, occurrence_time);
    CREATE INDEX IF NOT EXISTS idx_ledger_member ON class_credit_ledger(member_id);
    CREATE INDEX IF NOT EXISTS idx_occurrence_bookings_occurrence ON occurrence_bookings(class_occurrence_id);
  `);
}

/** days_of_week: "0,2,4" = Sun, Tue, Thu. time: "18:00". Returns dates in YYYY-MM-DD. */
export function getNextOccurrenceDates(daysOfWeek: string, time: string, fromDate: Date, weeks: number): { date: string; time: string }[] {
  const days = daysOfWeek.split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) return [];
  const out: { date: string; time: string }[] = [];
  const end = new Date(fromDate);
  end.setDate(end.getDate() + weeks * 7);
  const cur = new Date(fromDate);
  cur.setHours(0, 0, 0, 0);
  while (cur <= end) {
    if (days.includes(cur.getDay())) {
      out.push({
        date: cur.toISOString().slice(0, 10),
        time: time || "18:00",
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function getMemberCreditBalance(db: ReturnType<typeof getDb>, member_id: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) AS balance FROM class_credit_ledger WHERE member_id = ?").get(member_id) as { balance: number };
  return Number(row?.balance ?? 0);
}
