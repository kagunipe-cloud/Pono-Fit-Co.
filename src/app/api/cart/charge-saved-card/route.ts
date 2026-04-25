import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "@/lib/db";
import { ensureCartTables } from "@/lib/cart";
import { getEffectiveUnitPriceString } from "@/lib/cart-line-prices";
import { ensureDiscountsTable } from "@/lib/discounts";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "@/lib/recurring-classes";
import { getTrainerMemberId } from "@/lib/admin";
import { computeCcFee } from "@/lib/cc-fees";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import {
  getOffSessionRenewalBlockerIfResolvedPmIsNull,
  resolveStripeCustomerCardPaymentMethodId,
} from "@/lib/stripe-customer-payment-method";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * POST — Staff (admin or trainer) charges the member’s saved card for the current cart
 * (off-session, same as subscription retry). Fulfilment: client calls /api/cart/confirm-payment
 * with the returned `payment_intent_id` on success.
 *
 * Body: { member_id: string, monthly_recurring?: boolean } — `monthly_recurring` only when
 * the cart includes a monthly membership (false = one period, default true = auto-renew).
 */
export async function POST(request: NextRequest) {
  const staffId = await getTrainerMemberId(request);
  if (!staffId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const member_id = (body.member_id ?? "").trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureCartTables(db);
  ensureRecurringClassesTables(db);
  ensureClassesRecurringColumns(db);
  ensureClassOccurrencesClassId(db);
  ensurePTSlotTables(db);

  const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; promo_code?: string | null } | undefined;
  if (!cart) {
    db.close();
    return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
  }

  const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
    product_type: string;
    product_id: number;
    quantity: number;
    unit_price_override?: string | null;
  }[];

  if (rawItems.length === 0) {
    db.close();
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  let hasMonthlyMembershipInCart = false;
  for (const it of rawItems) {
    if (it.product_type !== "membership_plan") continue;
    const plan = db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(it.product_id) as { unit: string } | undefined;
    if (plan?.unit === "Month") hasMonthlyMembershipInCart = true;
  }

  const memberRow = db
    .prepare("SELECT email, stripe_customer_id FROM members WHERE member_id = ?")
    .get(member_id) as { email: string | null; stripe_customer_id: string | null } | undefined;

  const monthly_recurring_body = body.monthly_recurring as boolean | undefined;
  if (hasMonthlyMembershipInCart) {
    const wantsRenew = monthly_recurring_body !== false;
    if (wantsRenew && !memberRow?.email?.trim()) {
      db.close();
      return NextResponse.json(
        { error: "Member needs an email on file for monthly auto-renew when charging the saved card." },
        { status: 400 }
      );
    }
  }

  let subtotal = 0;
  for (const it of rawItems) {
    const price = getEffectiveUnitPriceString(db, it);
    subtotal += parsePrice(price) * Math.max(1, it.quantity);
  }

  let percentOff = 0;
  const promoCode = cart.promo_code?.trim();
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
  if (taxRateId) {
    try {
      const stripe = new Stripe(stripeSecret);
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      const pct = Number(taxRate.percentage) || 0;
      taxDollars = baseAmount * (pct / 100);
    } catch (e) {
      console.warn("[cart/charge-saved-card] Could not fetch tax rate, skipping tax:", e);
    }
  }

  const totalDollars = baseAmount + taxDollars;
  const amountCents = Math.round(totalDollars * 100);
  if (amountCents < 50) {
    db.close();
    return NextResponse.json({ error: "Amount must be at least $0.50" }, { status: 400 });
  }

  const stripeCustomerId = stripeCustomerIdForApi(memberRow?.stripe_customer_id);
  if (!stripeCustomerId) {
    db.close();
    return NextResponse.json(
      { error: "This member has no billable Stripe customer on file. Add a card with “Update payment method” on their profile, or use Pay with Stripe / front desk." },
      { status: 400 }
    );
  }

  db.close();

  const stripe = new Stripe(stripeSecret);
  const paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
  if (!paymentMethodId) {
    const blocker = await getOffSessionRenewalBlockerIfResolvedPmIsNull(stripe, stripeCustomerId);
    if (blocker) {
      return NextResponse.json({ error: blocker.message }, { status: 400 });
    }
  }

  try {
    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      off_session: true,
      confirm: true,
      description: "Cart (saved card, staff)",
      metadata: {
        member_id,
        type: "cart_off_session",
        ...(taxDollars > 0 ? { tax_amount: taxDollars.toFixed(2) } : {}),
        ...(hasMonthlyMembershipInCart
          ? { monthly_recurring: monthly_recurring_body === false ? "0" : "1" }
          : {}),
        ...(promoCode ? { promo_code: promoCode } : {}),
      },
    };
    if (paymentMethodId) {
      piParams.payment_method = paymentMethodId;
    }

    const pi = await stripe.paymentIntents.create(piParams);

    if (pi.status === "succeeded") {
      return NextResponse.json({ ok: true, payment_intent_id: pi.id });
    }
    if (pi.status === "requires_action" || pi.status === "processing") {
      return NextResponse.json(
        {
          error:
            "The bank needs extra verification for this card. Ask the member to use “Pay with Stripe” on this cart, or pay at the reader.",
        },
        { status: 409 }
      );
    }
    const errMsg =
      typeof pi.last_payment_error?.message === "string" && pi.last_payment_error.message.trim()
        ? pi.last_payment_error.message
        : `Payment not completed (status: ${pi.status})`;
    return NextResponse.json({ error: errMsg }, { status: 400 });
  } catch (err) {
    console.error("[cart/charge-saved-card]", err);
    const message = err instanceof Error ? err.message : "Failed to charge card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
