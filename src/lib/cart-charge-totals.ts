import type { getDb } from "./db";
import { getEffectiveUnitPriceString } from "./cart-line-prices";
import { ensureDiscountsTable } from "./discounts";
import { computeCcFee } from "./cc-fees";
import Stripe from "stripe";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export type CartLineForTotals = {
  product_type: string;
  product_id: number;
  quantity: number;
  unit_price_override?: string | null;
};

export type CartChargeTotals = {
  subtotal: number;
  percentOff: number;
  afterDiscount: number;
  ccFee: number;
  taxDollars: number;
  totalDollars: number;
  amountCents: number;
  promoCode: string | null;
};

/** Subtotal, promo, CC fee, optional Stripe tax — same rules as cart charge-saved-card. */
export async function computeCartChargeTotals(
  db: ReturnType<typeof getDb>,
  lines: CartLineForTotals[],
  promoCodeRaw: string | null | undefined,
  stripeSecret: string | undefined
): Promise<CartChargeTotals> {
  let subtotal = 0;
  for (const it of lines) {
    const price = getEffectiveUnitPriceString(db, it);
    subtotal += parsePrice(price) * Math.max(1, it.quantity);
  }

  let percentOff = 0;
  const promoCode = promoCodeRaw?.trim() || null;
  if (promoCode) {
    ensureDiscountsTable(db);
    const discount = db.prepare("SELECT percent_off FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as
      | { percent_off: number }
      | undefined;
    if (discount) percentOff = Math.min(100, Math.max(0, discount.percent_off));
  }

  const afterDiscount = Math.max(0, subtotal * (1 - percentOff / 100));
  const ccFee = computeCcFee(afterDiscount);
  const baseAmount = afterDiscount + ccFee;

  let taxDollars = 0;
  const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim();
  if (taxRateId && stripeSecret) {
    try {
      const stripe = new Stripe(stripeSecret);
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      const pct = Number(taxRate.percentage) || 0;
      taxDollars = baseAmount * (pct / 100);
    } catch (e) {
      console.warn("[cart-charge-totals] Could not fetch tax rate, skipping tax:", e);
    }
  }

  const totalDollars = baseAmount + taxDollars;
  const amountCents = Math.round(totalDollars * 100);

  return {
    subtotal,
    percentOff,
    afterDiscount,
    ccFee,
    taxDollars,
    totalDollars,
    amountCents,
    promoCode,
  };
}
