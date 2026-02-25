import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "the-fox-says.db");
const restorePendingPath = path.join(process.cwd(), "data", "restore-pending.db");

let restoreApplied = false;
/** On first getDb() after deploy, replace DB with restore-pending.db if present (from admin restore). */
function applyPendingRestore() {
  if (restoreApplied) return;
  if (!fs.existsSync(restorePendingPath)) return;
  restoreApplied = true;
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(restorePendingPath, dbPath);
    fs.unlinkSync(restorePendingPath);
    console.log("[db] Applied pending restore.");
  } catch (err) {
    console.error("[db] Restore failed:", err);
  }
}

/** Ensures base schema exists (so fresh deploys / new volumes don't 500 on members/subscriptions). */
function ensureBaseSchema(db: Database.Database) {
  try {
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

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    ensureAppSettingsDefaults(db);
  } catch (err) {
    console.error("[db] ensureBaseSchema failed:", err);
    throw err;
  }
}

const DEFAULT_TIMEZONE = "Pacific/Honolulu";

function ensureAppSettingsDefaults(db: Database.Database) {
  const row = db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("timezone");
  if (!row) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("timezone", DEFAULT_TIMEZONE);
  }
}

/** Get the gym's timezone (e.g. for schedules, macros, usage). Default Pacific/Honolulu. */
export function getAppTimezone(db: ReturnType<typeof getDb>): string {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
  const tz = row?.value?.trim();
  return tz && Intl.DateTimeFormat().resolvedOptions().timeZone ? tz : DEFAULT_TIMEZONE;
}

export function getDb() {
  applyPendingRestore();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error("[db] mkdir failed:", dir, err);
      throw err;
    }
  }
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
