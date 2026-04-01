import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "@/lib/db";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import { ensureCartTables } from "@/lib/cart";
import { getEffectiveUnitPriceString } from "@/lib/cart-line-prices";
import { ensureDiscountsTable } from "@/lib/discounts";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "@/lib/recurring-classes";
import { getAdminMemberId } from "@/lib/admin";
import { computeCcFee } from "@/lib/cc-fees";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Attach Terminal charges to a real Stripe Customer so Dashboard/receipts line up and
 * confirm-payment can persist members.stripe_customer_id. Reuses DB id, else first Customer
 * with same email, else creates one.
 */
async function resolveStripeCustomerIdForTerminal(
  stripe: Stripe,
  member_id: string,
  email: string | null,
  existingStripeId: string | null
): Promise<string | null> {
  const existing = stripeCustomerIdForApi(existingStripeId);
  if (existing) return existing;
  const em = email?.trim();
  if (!em) return null;
  const list = await stripe.customers.list({ email: em, limit: 5 });
  if (list.data.length > 0) return list.data[0]!.id;
  const c = await stripe.customers.create({
    email: em,
    metadata: { member_id },
  });
  return c.id;
}

/**
 * POST — Create PaymentIntent and process on reader (admin only).
 * Body: { member_id, reader_id, monthly_recurring?: boolean } — when cart has a monthly membership,
 * `monthly_recurring` matches Checkout (false = one period only, default true = auto-renew).
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const member_id = (body.member_id ?? "").trim();
  const reader_id = (body.reader_id ?? "").trim();
  if (!member_id || !reader_id) {
    return NextResponse.json({ error: "member_id and reader_id required" }, { status: 400 });
  }

  const db = getDb();
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

  let hasMonthlyMembershipInCart = false;
  for (const it of rawItems) {
    if (it.product_type !== "membership_plan") continue;
    const plan = db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(it.product_id) as { unit: string } | undefined;
    if (plan?.unit === "Month") hasMonthlyMembershipInCart = true;
  }

  const memberRow = db.prepare("SELECT email, stripe_customer_id FROM members WHERE member_id = ?").get(member_id) as
    | { email: string | null; stripe_customer_id: string | null }
    | undefined;

  /** Staff-only: false = one billing period only (no auto-renew). Omitted or true = recurring. */
  const monthly_recurring_body = body.monthly_recurring as boolean | undefined;
  if (hasMonthlyMembershipInCart) {
    const wantsRenew = monthly_recurring_body !== false;
    if (wantsRenew && !memberRow?.email?.trim()) {
      db.close();
      return NextResponse.json(
        { error: "Member needs an email on file for monthly auto-renew on the terminal." },
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
    const discount = db.prepare("SELECT percent_off FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as { percent_off: number } | undefined;
    if (discount) percentOff = Math.min(100, Math.max(0, discount.percent_off));
  }

  db.close();

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
      console.warn("[terminal/charge] Could not fetch tax rate, skipping tax:", e);
    }
  }

  const totalDollars = baseAmount + taxDollars;
  const amountCents = Math.round(totalDollars * 100);
  if (amountCents < 50) {
    return NextResponse.json({ error: "Amount must be at least $0.50" }, { status: 400 });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const stripeCustomerId = await resolveStripeCustomerIdForTerminal(
      stripe,
      member_id,
      memberRow?.email ?? null,
      memberRow?.stripe_customer_id ?? null
    );
    if (stripeCustomerId) {
      const dbStripe = getDb();
      ensureMembersStripeColumn(dbStripe);
      dbStripe.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(stripeCustomerId, member_id);
      dbStripe.close();
    }

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: {
        member_id,
        ...(taxDollars > 0 ? { tax_amount: taxDollars.toFixed(2) } : {}),
        ...(hasMonthlyMembershipInCart
          ? { monthly_recurring: monthly_recurring_body === false ? "0" : "1" }
          : {}),
      },
    };
    if (stripeCustomerId) {
      piParams.customer = stripeCustomerId;
      /** Saves a reusable `card` (generated_card) on the Customer for off-session renewals; mirrors Checkout. */
      piParams.setup_future_usage = "off_session";
    }

    const pi = await stripe.paymentIntents.create(piParams);

    await stripe.terminal.readers.processPaymentIntent(reader_id, {
      payment_intent: pi.id,
      ...(stripeCustomerId ? { process_config: { allow_redisplay: "always" } } : {}),
    });

    return NextResponse.json({ payment_intent_id: pi.id });
  } catch (err) {
    console.error("[terminal/charge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process payment" },
      { status: 500 }
    );
  }
}
