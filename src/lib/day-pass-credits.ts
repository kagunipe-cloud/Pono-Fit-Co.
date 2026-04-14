/**
 * Day pass / pass-pack credits — same ledger pattern as class_credit_ledger and pt_credit_ledger.
 * Positive amounts = purchase or grant; negative = activation (one calendar day used).
 */

import type { getDb } from "./db";
import { isPassPackPlan } from "./pass-packs";

export function ensureDayPassCreditLedger(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_pass_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_day_pass_credit_ledger_member ON day_pass_credit_ledger(member_id);
  `);
}

export function getMemberDayPassLedgerBalance(db: ReturnType<typeof getDb>, memberId: string): number {
  ensureDayPassCreditLedger(db);
  const row = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM day_pass_credit_ledger WHERE member_id = ?")
    .get(memberId) as { b: number };
  return Math.max(0, Math.floor(Number(row?.b ?? 0)));
}

/** Ensure members.pass_activation_day exists (which calendar day a pass was last activated). */
export function ensureMembersPassActivationDayColumn(db: ReturnType<typeof getDb>) {
  try {
    db.exec("ALTER TABLE members ADD COLUMN pass_activation_day TEXT");
  } catch {
    /* already exists */
  }
}

/**
 * One-time: move banked days from subscription rows into day_pass_credit_ledger, cancel those subs,
 * copy pass_activation_day onto members. Idempotent via app_settings.
 */
export function migrateLegacyPassPackSubscriptionsToLedger(db: ReturnType<typeof getDb>) {
  ensureDayPassCreditLedger(db);
  ensureMembersPassActivationDayColumn(db);
  const done = db.prepare("SELECT 1 FROM app_settings WHERE key = 'day_pass_ledger_migrated_v1' AND value = '1'").get();
  if (done) return;

  const packSubs = db
    .prepare(
      `SELECT s.subscription_id, s.member_id, s.pass_credits_remaining, s.pass_activation_day, s.start_date,
              p.category, p.unit
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.pass_credits_remaining IS NOT NULL AND s.pass_credits_remaining > 0
       ORDER BY s.start_date DESC`
    )
    .all() as {
    subscription_id: string;
    member_id: string;
    pass_credits_remaining: number;
    pass_activation_day: string | null;
    start_date: string;
    category: string | null;
    unit: string | null;
  }[];

  const insertLedger = db.prepare(
    `INSERT INTO day_pass_credit_ledger (member_id, amount, reason, reference_type, reference_id)
     VALUES (?, ?, 'migration_from_subscription', 'subscription', ?)`
  );
  const cancelSub = db.prepare(
    `UPDATE subscriptions SET pass_credits_remaining = NULL, pass_activation_day = NULL, status = 'Cancelled'
     WHERE subscription_id = ?`
  );
  const setMemberActivation = db.prepare(
    `UPDATE members SET pass_activation_day = ? WHERE member_id = ? AND (pass_activation_day IS NULL OR trim(pass_activation_day) = '')`
  );

  db.exec("BEGIN");
  try {
    const seenActivation = new Map<string, string>();
    const withPlan = db
      .prepare(
        `SELECT s.member_id, s.pass_activation_day, p.category, p.unit
         FROM subscriptions s
         JOIN membership_plans p ON p.product_id = s.product_id
         WHERE trim(COALESCE(s.pass_activation_day, '')) != ''`
      )
      .all() as { member_id: string; pass_activation_day: string; category: string | null; unit: string | null }[];

    for (const r of withPlan) {
      if (!isPassPackPlan({ category: r.category, unit: r.unit })) continue;
      if (!seenActivation.has(r.member_id)) {
        seenActivation.set(r.member_id, r.pass_activation_day.trim());
      }
    }

    for (const r of packSubs) {
      if (!isPassPackPlan({ category: r.category, unit: r.unit })) continue;
      insertLedger.run(r.member_id, r.pass_credits_remaining, r.subscription_id);
      cancelSub.run(r.subscription_id);
    }

    for (const [memberId, ymd] of seenActivation) {
      setMemberActivation.run(ymd, memberId);
    }

    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('day_pass_ledger_migrated_v1', '1')").run();
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}
