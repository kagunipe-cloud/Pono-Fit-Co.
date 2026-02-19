import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "the-fox-says.db");

/** Ensures base schema exists (so fresh deploys / new volumes don't 500 on members/subscriptions). */
function ensureBaseSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      kisi_id TEXT,
      kisi_group_id TEXT,
      join_date TEXT,
      exp_next_payment_date TEXT,
      role TEXT,
      stripe_customer_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_members_search ON members(first_name, last_name, email, role);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT,
      member_id TEXT,
      product_id TEXT,
      status TEXT,
      start_date TEXT,
      expiry_date TEXT,
      days_remaining TEXT,
      kisi_id TEXT,
      health_check TEXT,
      price TEXT,
      sales_id TEXT,
      quantity TEXT
    );

    CREATE TABLE IF NOT EXISTS membership_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT,
      plan_name TEXT,
      price TEXT,
      length TEXT,
      unit TEXT,
      access_level TEXT,
      stripe_link TEXT,
      category TEXT,
      description TEXT
    );
  `);
}

export function getDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  ensureBaseSchema(db);
  return db;
}

export function initDb() {
  const db = getDb();
  return db;
}

/** Add stripe_customer_id to members if missing (for existing DBs). */
export function ensureMembersStripeColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN stripe_customer_id TEXT");
  } catch {
    // Column already exists
  }
}

/** Add password_hash to members if missing (for member login). */
export function ensureMembersPasswordColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN password_hash TEXT");
  } catch {
    // Column already exists
  }
}

export type Member = {
  id: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  kisi_id: string | null;
  kisi_group_id: string | null;
  join_date: string | null;
  exp_next_payment_date: string | null;
  role: string | null;
  stripe_customer_id: string | null;
  password_hash: string | null;
  created_at: string | null;
};
