import type { getDb } from "./db";
import type { RenewalSubRow } from "./renewal-extension";

type AppDb = ReturnType<typeof getDb>;

export function parsePriceToCents(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

type SubQueryRow = {
  subscription_id: string;
  member_id: string;
  expiry_date: string;
  sub_price: string;
  quantity: number | string | null;
  promo_renewals_remaining: number | null;
  renewal_price_indefinite: number | null;
  plan_name: string;
  plan_price: string;
  length: string;
  unit: string;
  complimentary: number | null;
  complimentary_renewals_remaining: number | null;
  renewal_discount_percent: number | null;
};

/** Active monthly subscription for admin retry / terminal renewal (same query as money-owed-action). */
export function loadActiveMonthlySubscription(
  db: AppDb,
  memberId: string,
  subscriptionId: string | null | undefined
): RenewalSubRow | null {
  const base = `
    SELECT s.subscription_id, s.member_id, s.expiry_date, s.price as sub_price, s.quantity,
           s.promo_renewals_remaining, s.renewal_price_indefinite,
           s.complimentary, s.complimentary_renewals_remaining, s.renewal_discount_percent,
           p.plan_name, p.price as plan_price, p.length, p.unit
    FROM subscriptions s
    JOIN membership_plans p ON p.product_id = s.product_id
    WHERE s.member_id = ? AND s.status = 'Active' AND p.unit = 'Month'
  `;
  const sid = subscriptionId?.trim();
  const row = sid
    ? (db.prepare(`${base} AND s.subscription_id = ?`).get(memberId, sid) as SubQueryRow | undefined)
    : (db.prepare(`${base} ORDER BY s.expiry_date ASC LIMIT 1`).get(memberId) as SubQueryRow | undefined);
  if (!row) return null;
  return {
    subscription_id: row.subscription_id,
    member_id: row.member_id,
    expiry_date: row.expiry_date,
    sub_price: row.sub_price,
    quantity: row.quantity ?? 1,
    promo_renewals_remaining: row.promo_renewals_remaining,
    renewal_price_indefinite: row.renewal_price_indefinite,
    complimentary: row.complimentary,
    complimentary_renewals_remaining: row.complimentary_renewals_remaining,
    renewal_discount_percent: row.renewal_discount_percent,
    plan_name: row.plan_name,
    plan_price: row.plan_price,
    length: row.length,
    unit: row.unit,
  };
}

export function normalizeSubscriptionKey(subscriptionId: string | null | undefined): string {
  return subscriptionId != null && String(subscriptionId).trim() !== "" ? String(subscriptionId).trim() : "";
}

/**
 * Latest cancelled monthly subscription (by prior period end). Used to reactivate after
 * end-of-period cancel (auto-renew off) with an off-session card charge.
 */
export function loadLatestCancelledMonthlySubscription(
  db: AppDb,
  memberId: string,
  subscriptionId: string | null | undefined
): RenewalSubRow | null {
  const base = `
    SELECT s.subscription_id, s.member_id, s.expiry_date, s.price as sub_price, s.quantity,
           s.promo_renewals_remaining, s.renewal_price_indefinite,
           s.complimentary, s.complimentary_renewals_remaining, s.renewal_discount_percent,
           p.plan_name, p.price as plan_price, p.length, p.unit
    FROM subscriptions s
    JOIN membership_plans p ON p.product_id = s.product_id
    WHERE s.member_id = ? AND s.status = 'Cancelled' AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'
      AND s.pass_credits_remaining IS NULL
  `;
  const sid = subscriptionId?.trim();
  const row = sid
    ? (db.prepare(`${base} AND s.subscription_id = ?`).get(memberId, sid) as SubQueryRow | undefined)
    : (db.prepare(`${base} ORDER BY s.expiry_date DESC LIMIT 1`).get(memberId) as SubQueryRow | undefined);
  if (!row) return null;
  return {
    subscription_id: row.subscription_id,
    member_id: row.member_id,
    expiry_date: row.expiry_date,
    sub_price: row.sub_price,
    quantity: row.quantity ?? 1,
    promo_renewals_remaining: row.promo_renewals_remaining,
    renewal_price_indefinite: row.renewal_price_indefinite,
    complimentary: row.complimentary,
    complimentary_renewals_remaining: row.complimentary_renewals_remaining,
    renewal_discount_percent: row.renewal_discount_percent,
    plan_name: row.plan_name,
    plan_price: row.plan_price,
    length: row.length,
    unit: row.unit,
  };
}
