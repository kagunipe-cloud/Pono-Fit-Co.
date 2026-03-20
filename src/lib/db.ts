import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { normalizeDateToYMD } from "./app-timezone";
import { ensureTrainersTable } from "./trainers";
import { ensureTrainerClientsTable } from "./trainer-clients";
import { ensureBodyCompositionTable } from "./body-composition";
import { ensureClientGoalsTable } from "./client-goals";
import { ensureGymsTable } from "./gyms";

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

const DEFAULT_OPEN_HOUR_MIN = 6;
const DEFAULT_OPEN_HOUR_MAX = 22;

function ensureAppSettingsDefaults(db: Database.Database) {
  const row = db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("timezone");
  if (!row) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("timezone", DEFAULT_TIMEZONE);
  }
  const openMin = db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("open_hour_min");
  if (!openMin) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("open_hour_min", String(DEFAULT_OPEN_HOUR_MIN));
  }
  const openMax = db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("open_hour_max");
  if (!openMax) {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("open_hour_max", String(DEFAULT_OPEN_HOUR_MAX));
  }
}

/** Get open hours (0–23). Default 6–22. */
export function getOpenHours(db: ReturnType<typeof getDb>): { openHourMin: number; openHourMax: number } {
  const minRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("open_hour_min") as { value: string } | undefined;
  const maxRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("open_hour_max") as { value: string } | undefined;
  const min = Math.max(0, Math.min(23, parseInt(minRow?.value ?? String(DEFAULT_OPEN_HOUR_MIN), 10) || DEFAULT_OPEN_HOUR_MIN));
  const max = Math.max(0, Math.min(23, parseInt(maxRow?.value ?? String(DEFAULT_OPEN_HOUR_MAX), 10) || DEFAULT_OPEN_HOUR_MAX));
  return { openHourMin: Math.min(min, max), openHourMax: Math.max(min, max) };
}

/** Get the gym's timezone (e.g. for schedules, macros, usage). Uses gyms.timezone first, else app_settings. Default Pacific/Honolulu. */
export function getAppTimezone(db: ReturnType<typeof getDb>, gymId: number | null = 1): string {
  const gym = db.prepare("SELECT timezone FROM gyms WHERE id = ?").get(gymId ?? 1) as { timezone: string | null } | undefined;
  let tz = gym?.timezone?.trim();
  if (!tz) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
    tz = row?.value?.trim();
  }
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
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
  ensureGymsTable(db);
  ensureBaseSchema(db);
  ensureSalesSaleDateColumn(db);
  ensureSalesTaxAmountColumn(db);
  ensureSalesStripePaymentIntentColumn(db);
  ensureSalesItemTotalCcFeeColumns(db);
  ensureSalesTypeColumn(db);
  ensureSubscriptionsSalesIdColumn(db);
  ensureMembersWaiverColumns(db);
  ensureMembersPhoneColumn(db);
  ensureMembersCreatedAtColumn(db);
  ensurePaymentFailuresTable(db);
  ensureMembersMemberIdUnique(db);
  ensureGymIdColumns(db);
  ensureDatesNormalized(db);
  ensureTrainersTable(db);
  ensureTrainerClientsTable(db);
  ensureBodyCompositionTable(db);
  ensureClientGoalsTable(db);
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

/** Add auto_renew (0/1) to members. 1 = charge saved card when subscription expires. Default 0. */
export function ensureMembersAutoRenewColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN auto_renew INTEGER DEFAULT 0");
  } catch {
    // Column already exists
  }
  try {
    db.exec("UPDATE members SET auto_renew = 0 WHERE auto_renew IS NULL");
  } catch {
    /* ignore */
  }
}

/** Ensure sales table exists (created by cart/confirm-payment). */
function ensureSalesTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_id TEXT,
      date_time TEXT,
      member_id TEXT,
      stripe_link TEXT,
      grand_total TEXT,
      email TEXT,
      status TEXT,
      price TEXT,
      sale_date TEXT
    )
  `);
}

/** Add sale_date (YYYY-MM-DD) to sales if missing, for date-range filtering. */
export function ensureSalesSaleDateColumn(db: ReturnType<typeof getDb>) {
  ensureSalesTable(db);
  try {
    db.exec("ALTER TABLE sales ADD COLUMN sale_date TEXT");
  } catch {
    // Column already exists
  }
}

/** Add tax_amount (dollars) to sales if missing, for Stripe tax tracking. */
export function ensureSalesTaxAmountColumn(db: ReturnType<typeof getDb>) {
  ensureSalesTable(db);
  try {
    db.exec("ALTER TABLE sales ADD COLUMN tax_amount TEXT");
  } catch {
    // Column already exists
  }
}

/** Add stripe_payment_intent_id to sales for webhook lookup (ACH failure → revoke). */
export function ensureSalesStripePaymentIntentColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE sales ADD COLUMN stripe_payment_intent_id TEXT");
  } catch {
    // Column already exists
  }
}

/** Add promo_code to sales for discount tracking. */
export function ensureSalesPromoCodeColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE sales ADD COLUMN promo_code TEXT");
  } catch {
    // Column already exists
  }
}

/** Add item_total and cc_fee to sales for transaction breakdown. */
export function ensureSalesItemTotalCcFeeColumns(db: ReturnType<typeof getDb>) {
  ensureSalesTable(db);
  try {
    db.exec("ALTER TABLE sales ADD COLUMN item_total TEXT");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE sales ADD COLUMN cc_fee TEXT");
  } catch {
    /* already exists */
  }
}

/** Add sale_type to sales: 'purchase' | 'renewal' | 'complimentary'. For billing history and report attribution. */
export function ensureSalesTypeColumn(db: ReturnType<typeof getDb>) {
  ensureSalesTable(db);
  try {
    db.exec("ALTER TABLE sales ADD COLUMN sale_type TEXT DEFAULT 'purchase'");
  } catch {
    /* already exists */
  }
}

/** Add sales_id to subscriptions if missing (links subscription to sale for reporting). */
export function ensureSubscriptionsSalesIdColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE subscriptions ADD COLUMN sales_id TEXT");
  } catch {
    // Column already exists
  }
}

/** Add waiver columns to members if missing (liability waiver before Kisi access). */
export function ensureMembersWaiverColumns(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN waiver_signed_at TEXT");
  } catch {
    // already exists
  }
  try {
    db.exec("ALTER TABLE members ADD COLUMN waiver_token TEXT");
  } catch {
    // already exists
  }
  try {
    db.exec("ALTER TABLE members ADD COLUMN waiver_token_expires_at TEXT");
  } catch {
    // already exists
  }
  try {
    db.exec("ALTER TABLE members ADD COLUMN privacy_terms_accepted_at TEXT");
  } catch {
    // already exists
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

/** Add phone to members if missing (optional contact number). */
export function ensureMembersPhoneColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN phone TEXT");
  } catch {
    // Column already exists
  }
}

/** Add created_at to members if missing. Backfills NULL with join_date so leads "Signed up" column shows something. */
export function ensureMembersCreatedAtColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  } catch {
    // Column already exists
  }
  try {
    db.exec("UPDATE members SET created_at = join_date WHERE created_at IS NULL AND join_date IS NOT NULL AND TRIM(join_date) != ''");
  } catch {
    /* ignore */
  }
}

/** Ensure members.member_id has a UNIQUE index so trainers FK (trainers.member_id → members.member_id) is valid. */
export function ensureMembersMemberIdUnique(db: ReturnType<typeof getDb>) {
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_members_member_id ON members(member_id)");
  } catch {
    // Index already exists or duplicates exist (caller may need to fix data)
  }
}

/** All tenant-scoped tables that need gym_id for multi-tenant isolation. */
const GYM_ID_TABLES = [
  "members",
  "subscriptions",
  "membership_plans",
  "payment_failures",
  "trainers",
  "pt_sessions",
  "classes",
  "recurring_classes",
  "cart",
  "cart_items",
  "door_access_events",
  "app_usage_events",
  "sales",
  "pt_bookings",
  "class_bookings",
  // PT slots
  "trainer_availability",
  "pt_trainer_specific_bookings",
  "pt_slot_bookings",
  "pt_credit_ledger",
  "pt_pack_products",
  "pt_open_bookings",
  "unavailable_blocks",
  // Recurring classes
  "class_occurrences",
  "class_pack_products",
  "class_credit_ledger",
  "occurrence_bookings",
  // Rec leagues
  "rec_leagues",
  "rec_teams",
  "rec_team_league_enrollments",
  "rec_team_members",
  "rec_team_invites",
  "rec_games",
  "rec_waiver_tokens",
  "rec_playoff_brackets",
] as const;

/** Add gym_id to tenant-scoped tables. NULL/1 = default gym. Enables Stripe Connect + multi-tenant later. */
function ensureGymIdColumns(db: ReturnType<typeof getDb>) {
  for (const table of GYM_ID_TABLES) {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (info.length > 0 && !info.some((c) => c.name === "gym_id")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN gym_id INTEGER DEFAULT 1`);
      }
    } catch {
      /* table may not exist yet (created lazily) or column already exists */
    }
  }
  ensureGymIdIndexes(db);
}

/** Add indexes on gym_id for query performance when filtering by tenant. */
function ensureGymIdIndexes(db: ReturnType<typeof getDb>) {
  const indexTables = ["members", "subscriptions", "sales", "cart", "pt_sessions", "classes", "trainers"];
  for (const table of indexTables) {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (info.some((c) => c.name === "gym_id")) {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_gym_id ON ${table}(gym_id)`);
      }
    } catch {
      /* table may not exist */
    }
  }
}

/**
 * All date-only columns are stored as YYYY-MM-DD, which sorts correctly as text.
 * @param columnRef - Full column reference, e.g. "s.expiry_date" or "expiry_date"
 */
export function expiryDateSortableSql(columnRef: string): string {
  return columnRef;
}

/** Normalize date columns to YYYY-MM-DD. Runs once; uses app_settings flag. */
function ensureDatesNormalized(db: ReturnType<typeof getDb>) {
  try {
    const done = db.prepare("SELECT 1 FROM app_settings WHERE key = ? AND value = ?").get("dates_normalized", "1");
    if (done) return;
    const members = db.prepare("SELECT member_id, join_date, exp_next_payment_date FROM members").all() as {
      member_id: string;
      join_date: string | null;
      exp_next_payment_date: string | null;
    }[];
    const updMember = db.prepare("UPDATE members SET join_date = ?, exp_next_payment_date = ? WHERE member_id = ?");
    for (const m of members) {
      const join = normalizeDateToYMD(m.join_date) ?? m.join_date;
      const exp = normalizeDateToYMD(m.exp_next_payment_date) ?? m.exp_next_payment_date;
      if (join !== m.join_date || exp !== m.exp_next_payment_date) {
        updMember.run(join, exp, m.member_id);
      }
    }
    const subs = db.prepare("SELECT subscription_id, start_date, expiry_date FROM subscriptions").all() as {
      subscription_id: string;
      start_date: string | null;
      expiry_date: string | null;
    }[];
    const updSub = db.prepare("UPDATE subscriptions SET start_date = ?, expiry_date = ? WHERE subscription_id = ?");
    for (const s of subs) {
      const start = normalizeDateToYMD(s.start_date) ?? s.start_date;
      const expiry = normalizeDateToYMD(s.expiry_date) ?? s.expiry_date;
      if (start !== s.start_date || expiry !== s.expiry_date) {
        updSub.run(start, expiry, s.subscription_id);
      }
    }
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run("dates_normalized", "1");
  } catch {
    /* tables may not exist yet */
  }
}

/** Table of failed/skipped recurring payment attempts for the Money Owed report. */
export function ensurePaymentFailuresTable(db: ReturnType<typeof getDb>) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS payment_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        subscription_id TEXT,
        plan_name TEXT,
        amount_cents INTEGER,
        reason TEXT NOT NULL,
        stripe_error_code TEXT,
        attempted_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (err) {
    console.error("[db] ensurePaymentFailuresTable", err);
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
  phone: string | null;
  created_at: string | null;
};
