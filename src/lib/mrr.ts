import {
  ensureMembersAccountDeletedAtColumn,
  ensureMembersAutoRenewColumn,
  ensureSubscriptionPauseStartedColumn,
  type getDb,
} from "./db";
import { computeRenewalChargePrice, type RenewalPricingInput } from "./renewal-pricing";

type AppDb = ReturnType<typeof getDb>;

export type AutoRenewSubscriptionRow = {
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
};

const AVG_DAYS_PER_MONTH = 365.25 / 12;

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

/** Monthly recurring revenue for one active auto-renew subscription row (0 if complimentary / free). */
export function subscriptionMonthlyRecurringRevenueUsd(row: AutoRenewSubscriptionRow): number {
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

export function loadAutoRenewSubscriptionRows(db: AppDb): AutoRenewSubscriptionRow[] {
  ensureMembersAutoRenewColumn(db);
  ensureSubscriptionPauseStartedColumn(db);
  ensureMembersAccountDeletedAtColumn(db);

  return db
    .prepare(
      `SELECT s.member_id, s.subscription_id, s.price AS sub_price, s.quantity,
              s.promo_renewals_remaining, s.renewal_price_indefinite,
              s.renewal_discount_percent, s.complimentary,
              p.price AS plan_price, p.length, p.unit
       FROM members m
       INNER JOIN subscriptions s ON s.member_id = m.member_id
       INNER JOIN membership_plans p ON p.product_id = s.product_id
       WHERE COALESCE(m.auto_renew, 0) = 1
         AND s.status = 'Active'
         AND s.pass_credits_remaining IS NULL
         AND TRIM(COALESCE(s.subscription_pause_started, '')) = ''
         AND (m.account_deleted_at IS NULL OR TRIM(COALESCE(m.account_deleted_at, '')) = '')`
    )
    .all() as AutoRenewSubscriptionRow[];
}

export function computeMrrSummary(db: AppDb): { mrr: number; memberCount: number } {
  const rows = loadAutoRenewSubscriptionRows(db);
  const memberMrr = new Map<string, number>();

  for (const row of rows) {
    const subMrr = subscriptionMonthlyRecurringRevenueUsd(row);
    if (subMrr <= 0) continue;
    memberMrr.set(row.member_id, (memberMrr.get(row.member_id) ?? 0) + subMrr);
  }

  let mrr = 0;
  for (const value of memberMrr.values()) mrr += value;

  return { mrr: Math.round(mrr * 100) / 100, memberCount: memberMrr.size };
}

export function getAutoRenewRecurringMemberIds(db: AppDb): Set<string> {
  const ids = new Set<string>();
  for (const row of loadAutoRenewSubscriptionRows(db)) {
    if (subscriptionMonthlyRecurringRevenueUsd(row) > 0) ids.add(row.member_id);
  }
  return ids;
}
