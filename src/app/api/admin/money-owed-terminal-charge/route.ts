import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  ensureMembersStripeColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
} from "@/lib/db";
import { computeRenewalChargePrice } from "@/lib/renewal-pricing";
import { getAdminMemberId } from "@/lib/admin";
import { computeCcFee } from "@/lib/cc-fees";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import {
  loadActiveMonthlySubscription,
  normalizeSubscriptionKey,
  parsePriceToCents,
} from "@/lib/money-owed-renewal-load";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

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
 * POST — Start Stripe Terminal charge for a money-owed monthly renewal (same amount as cron / card retry).
 * Body: { member_id, subscription_id, reader_id }
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

  let body: { member_id?: string; subscription_id?: string | null; reader_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const member_id = (body.member_id ?? "").trim();
  const reader_id = (body.reader_id ?? "").trim();
  const subscription_id = body.subscription_id != null ? String(body.subscription_id).trim() : "";

  if (!member_id || !reader_id) {
    return NextResponse.json({ error: "member_id and reader_id required" }, { status: 400 });
  }

  const db = getDb();
  ensurePaymentFailuresTable(db);
  ensureMembersStripeColumn(db);
  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);

  const subscriptionKey = normalizeSubscriptionKey(subscription_id || null);
  const openCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM payment_failures
       WHERE member_id = ? AND COALESCE(subscription_id, '') = ?
         AND (dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = '')`
    )
    .get(member_id, subscriptionKey) as { c: number } | undefined;

  if (!openCount || openCount.c < 1) {
    db.close();
    return NextResponse.json({ error: "No open failed payments for this member/subscription" }, { status: 404 });
  }

  const memberRow = db
    .prepare(`SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?`)
    .get(member_id) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  const sub = loadActiveMonthlySubscription(db, member_id, subscription_id || null);
  if (!sub) {
    db.close();
    return NextResponse.json(
      { error: "No active monthly subscription found. Restore or create a membership first." },
      { status: 400 }
    );
  }

  if ((sub.complimentary ?? 0) === 1) {
    db.close();
    return NextResponse.json({ error: "Complimentary memberships use Write off, not terminal charge." }, { status: 400 });
  }

  db.close();

  const priceStr = computeRenewalChargePrice(sub.plan_price, {
    sub_price: sub.sub_price,
    promo_renewals_remaining: sub.promo_renewals_remaining,
    renewal_price_indefinite: sub.renewal_price_indefinite,
    renewal_discount_percent: sub.renewal_discount_percent ?? null,
  });
  const amountCentsBase = parsePriceToCents(priceStr) * Math.max(1, Number(sub.quantity) || 1);
  const itemTotalDollars = amountCentsBase / 100;
  if (itemTotalDollars <= 0) {
    return NextResponse.json({ error: "Invalid renewal amount" }, { status: 400 });
  }

  const ccFeeDollars = computeCcFee(itemTotalDollars);
  const baseAmount = itemTotalDollars + ccFeeDollars;
  let taxDollars = 0;
  const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim();
  const stripe = new Stripe(stripeSecret);
  if (taxRateId) {
    try {
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      const pct = Number(taxRate.percentage) || 0;
      taxDollars = Math.round(baseAmount * (pct / 100) * 100) / 100;
    } catch {
      /* skip */
    }
  }
  const totalDollars = baseAmount + taxDollars;
  const chargeCents = Math.round(totalDollars * 100);
  if (chargeCents < 50) {
    return NextResponse.json({ error: "Amount must be at least $0.50" }, { status: 400 });
  }

  try {
    const stripeCustomerId = await resolveStripeCustomerIdForTerminal(
      stripe,
      member_id,
      memberRow.email ?? null,
      memberRow.stripe_customer_id ?? null
    );
    if (stripeCustomerId) {
      const dbStripe = getDb();
      ensureMembersStripeColumn(dbStripe);
      dbStripe.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(stripeCustomerId, member_id);
      dbStripe.close();
    }

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: chargeCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      description: `Money owed renewal: ${sub.plan_name}`,
      metadata: {
        money_owed_renewal: "1",
        member_id,
        subscription_id: sub.subscription_id,
        item_total: itemTotalDollars.toFixed(2),
        cc_fee: ccFeeDollars.toFixed(2),
        tax_amount: taxDollars.toFixed(2),
        grand_total: totalDollars.toFixed(2),
      },
    };
    if (stripeCustomerId) {
      piParams.customer = stripeCustomerId;
      piParams.setup_future_usage = "off_session";
    }

    const pi = await stripe.paymentIntents.create(piParams);

    await stripe.terminal.readers.processPaymentIntent(reader_id, {
      payment_intent: pi.id,
      ...(stripeCustomerId ? { process_config: { allow_redisplay: "always" } } : {}),
    });

    return NextResponse.json({ payment_intent_id: pi.id });
  } catch (err) {
    console.error("[money-owed-terminal-charge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start reader payment" },
      { status: 500 }
    );
  }
}
