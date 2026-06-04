import {
  ensureMembersAccountDeletedAtColumn,
  ensureMembersAutoRenewColumn,
  ensureSubscriptionPauseStartedColumn,
  type getDb,
} from "./db";
import { computeRenewalChargePrice, type RenewalPricingInput } from "./renewal-pricing";

type AppDb = ReturnType<typeof getDb>;

export type MonthlySubscriptionRow = {
  member_id: string;
  subscription_id: string;
  sub_price: string;
  quantity: number | string | null;
  promo_renewals_remaining: number | null;
  renewal_price_indefinite: number | null;
  renewal_discount_percent: number | null;
  complimentary: number | null;
  plan_price: string;
  length: string;
  unit: string;
  auto_renew: number;
  subscription_pause_started: string | null;
};

/** @deprecated Use MonthlySubscriptionRow */
export type AutoRenewSubscriptionRow = MonthlySubscriptionRow;

const AVG_DAYS_PER_MONTH = 365.25 / 12;

/** Match subscription.product_id to plan (product_id or legacy numeric plan id). */
export const MEMBERSHIP_PLAN_JOIN_SQL = `(
  TRIM(COALESCE(p.product_id, '')) = TRIM(COALESCE(s.product_id, ''))
  OR CAST(p.id AS TEXT) = TRIM(COALESCE(s.product_id, ''))
)`;

/** Same "Monthly" membership as the Members page: active sub + plan unit month. */
export const ACTIVE_MONTHLY_SUBSCRIPTION_SQL = `
  LOWER(TRIM(COALESCE(s.status, ''))) = 'active'
  AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'`;

function parseMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Convert plan length + unit into an average month fraction for MRR normalization. */
export function billingPeriodMonths(lengthRaw: string | number | null | undefined, unitRaw: string | null | undefined): number {
  const length = Math.max(1, Math.floor(Number(lengthRaw) || 1));
  const unit = String(unitRaw ?? "Month").trim().toLowerCase();
  if (unit === "month") return length;
  if (unit === "year") return length * 12;
  if (unit === "week") return (length * 7) / AVG_DAYS_PER_MONTH;
  if (unit === "day") return length / AVG_DAYS_PER_MONTH;
  return length;
}

/** Monthly recurring revenue for one active monthly subscription row (0 if complimentary / free). */
export function subscriptionMonthlyRecurringRevenueUsd(row: MonthlySubscriptionRow): number {
  if ((row.complimentary ?? 0) === 1) return 0;

  const pricing: RenewalPricingInput = {
    sub_price: row.sub_price,
    promo_renewals_remaining: row.promo_renewals_remaining,
    renewal_price_indefinite: row.renewal_price_indefinite,
    renewal_discount_percent: row.renewal_discount_percent,
  };
  const chargePerPeriod = parseMoney(computeRenewalChargePrice(row.plan_price, pricing));
  if (chargePerPeriod <= 0) return 0;

  const qty = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const periodMonths = billingPeriodMonths(row.length, row.unit);
  if (periodMonths <= 0) return 0;

  const mrr = (chargePerPeriod * qty) / periodMonths;
  return Math.round(mrr * 100) / 100;
}

const AUTO_RENEW_MONTHLY_SUBSCRIPTION_SQL = `
  SELECT s.member_id, s.subscription_id, s.price AS sub_price, s.quantity,
         s.promo_renewals_remaining, s.renewal_price_indefinite,
         s.renewal_discount_percent, s.complimentary,
         p.price AS plan_price, p.length, p.unit,
         COALESCE(m.auto_renew, 0) AS auto_renew,
         s.subscription_pause_started
  FROM members m
  INNER JOIN subscriptions s ON s.member_id = m.member_id
  INNER JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL}
  WHERE COALESCE(m.auto_renew, 0) = 1
    AND ${ACTIVE_MONTHLY_SUBSCRIPTION_SQL}
    AND (m.account_deleted_at IS NULL OR TRIM(COALESCE(m.account_deleted_at, '')) = '')`;

/** Active monthly membership + auto-renew checked on the member profile. */
export function loadAutoRenewMonthlySubscriptionRows(db: AppDb): MonthlySubscriptionRow[] {
  ensureMembersAutoRenewColumn(db);
  ensureSubscriptionPauseStartedColumn(db);
  ensureMembersAccountDeletedAtColumn(db);
  return db.prepare(AUTO_RENEW_MONTHLY_SUBSCRIPTION_SQL).all() as MonthlySubscriptionRow[];
}

function isSubscriptionPaused(row: MonthlySubscriptionRow): boolean {
  return String(row.subscription_pause_started ?? "").trim() !== "";
}

/** @deprecated Use loadAutoRenewMonthlySubscriptionRows */
export function loadAutoRenewSubscriptionRows(db: AppDb): MonthlySubscriptionRow[] {
  return loadAutoRenewMonthlySubscriptionRows(db);
}

export function getAutoRenewMonthlyMemberIds(db: AppDb): Set<string> {
  const ids = new Set<string>();
  for (const row of loadAutoRenewMonthlySubscriptionRows(db)) {
    ids.add(row.member_id);
  }
  return ids;
}

/** Members with auto-renew on and an active monthly membership (includes complimentary / $0). */
export function getAutoRenewRecurringMemberIds(db: AppDb): Set<string> {
  return getAutoRenewMonthlyMemberIds(db);
}

function countAutoRenewFlagMembers(db: AppDb): number {
  ensureMembersAutoRenewColumn(db);
  ensureMembersAccountDeletedAtColumn(db);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM members
       WHERE COALESCE(auto_renew, 0) = 1
         AND (account_deleted_at IS NULL OR TRIM(COALESCE(account_deleted_at, '')) = '')`
    )
    .get() as { c: number };
  return row?.c ?? 0;
}

export type AutoRenewUnmatchedMember = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  reason: string;
  detail: string | null;
};

function diagnoseAutoRenewUnmatched(
  subs: {
    status: string | null;
    plan_name: string | null;
    unit: string | null;
    product_id: string | null;
    plan_linked: number;
  }[]
): { reason: string; detail: string | null } {
  if (subs.length === 0) {
    return { reason: "No subscription", detail: null };
  }

  const active = subs.filter((s) => String(s.status ?? "").trim().toLowerCase() === "active");
  if (active.length === 0) {
    const statuses = [...new Set(subs.map((s) => String(s.status ?? "—").trim() || "—"))].join(", ");
    return { reason: "No active subscription", detail: `Status on file: ${statuses}` };
  }

  const activeMonthly = active.filter((s) => String(s.unit ?? "").trim().toLowerCase() === "month");
  if (activeMonthly.length === 0) {
    const bits = active.map((s) => {
      const name = String(s.plan_name ?? s.product_id ?? "—").trim();
      const unit = String(s.unit ?? "—").trim();
      return `${name} (${unit})`;
    });
    return { reason: "Active sub is not monthly", detail: bits.join("; ") };
  }

  const linkedMonthly = activeMonthly.filter((s) => Number(s.plan_linked) === 1);
  if (linkedMonthly.length === 0) {
    const bits = activeMonthly.map((s) => {
      const pid = String(s.product_id ?? "").trim() || "—";
      return `${String(s.plan_name ?? "Monthly plan").trim()} · product_id ${pid} (no matching plan row)`;
    });
    return { reason: "Plan link missing", detail: bits.join("; ") };
  }

  return { reason: "Not in recurring pool", detail: "Check paused or data sync" };
}

/** Members with auto_renew=1 but no row in loadAutoRenewMonthlySubscriptionRows (not in MRR / Monthly recurring). */
export function loadAutoRenewUnmatchedMembers(db: AppDb): AutoRenewUnmatchedMember[] {
  const matched = getAutoRenewMonthlyMemberIds(db);
  ensureMembersAutoRenewColumn(db);
  ensureMembersAccountDeletedAtColumn(db);

  const flagged = db
    .prepare(
      `SELECT member_id, first_name, last_name, email FROM members
       WHERE COALESCE(auto_renew, 0) = 1
         AND (account_deleted_at IS NULL OR TRIM(COALESCE(account_deleted_at, '')) = '')
       ORDER BY last_name ASC, first_name ASC`
    )
    .all() as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }[];

  const subStmt = db.prepare(
    `SELECT s.status, s.product_id, p.plan_name, p.unit,
            CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS plan_linked
     FROM subscriptions s
     LEFT JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL}
     WHERE s.member_id = ?
     ORDER BY CASE WHEN LOWER(TRIM(COALESCE(s.status, ''))) = 'active' THEN 0 ELSE 1 END,
              s.start_date DESC`
  );

  const out: AutoRenewUnmatchedMember[] = [];
  for (const m of flagged) {
    if (matched.has(m.member_id)) continue;
    const subs = subStmt.all(m.member_id) as {
      status: string | null;
      plan_name: string | null;
      unit: string | null;
      product_id: string | null;
      plan_linked: number;
    }[];
    const { reason, detail } = diagnoseAutoRenewUnmatched(subs);
    out.push({
      member_id: m.member_id,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
      reason,
      detail,
    });
  }
  return out;
}

export function computeMrrSummary(db: AppDb): {
  /** Billable MRR from auto-renew active monthly members only. */
  mrr: number;
  /** Distinct auto-renew members with a qualifying active monthly sub. */
  autoRenewMemberCount: number;
  /** Auto-renew members with billable renewal price (contributes to MRR). */
  autoRenewBillableMemberCount: number;
  /** Members with auto_renew=1 on file (may exceed autoRenewMemberCount). */
  autoRenewFlagCount: number;
  /** auto_renew=1 but not in autoRenewMemberCount (data gap to investigate). */
  autoRenewUnmatchedCount: number;
  autoRenewUnmatched: AutoRenewUnmatchedMember[];
} {
  const rows = loadAutoRenewMonthlySubscriptionRows(db);
  const autoRenewIds = new Set<string>();
  const autoRenewBillableIds = new Set<string>();
  let mrr = 0;

  for (const row of rows) {
    autoRenewIds.add(row.member_id);
    if (isSubscriptionPaused(row)) continue;
    const subMrr = subscriptionMonthlyRecurringRevenueUsd(row);
    if (subMrr <= 0) continue;
    mrr += subMrr;
    autoRenewBillableIds.add(row.member_id);
  }

  const autoRenewFlagCount = countAutoRenewFlagMembers(db);
  const autoRenewUnmatched = loadAutoRenewUnmatchedMembers(db);

  return {
    mrr: Math.round(mrr * 100) / 100,
    autoRenewMemberCount: autoRenewIds.size,
    autoRenewBillableMemberCount: autoRenewBillableIds.size,
    autoRenewFlagCount,
    autoRenewUnmatchedCount: autoRenewUnmatched.length,
    autoRenewUnmatched,
  };
}
