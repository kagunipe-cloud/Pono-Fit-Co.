/**
 * Monthly renewal charge amount: negotiated sub price, else % off catalog, else catalog.
 */

export type RenewalPricingInput = {
  sub_price: string;
  promo_renewals_remaining: number | null;
  renewal_price_indefinite: number | null;
  /** 1–99 = indefinite % off current membership_plans.price on each renewal. */
  renewal_discount_percent: number | null;
};

function parseMoney(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Dollar string for one unit: Stripe renewal / display. */
export function computeRenewalChargePrice(planPrice: string, sub: RenewalPricingInput): string {
  const useNegotiated =
    (sub.promo_renewals_remaining != null && sub.promo_renewals_remaining > 0) ||
    (sub.renewal_price_indefinite ?? 0) === 1;
  if (useNegotiated) return String(sub.sub_price ?? "0");
  const pct = sub.renewal_discount_percent;
  if (pct != null && pct > 0 && pct < 100) {
    const catalog = parseMoney(planPrice);
    const eff = catalog * (1 - pct / 100);
    return String(Math.round(eff * 100) / 100);
  }
  return String(planPrice);
}
