import Stripe from "stripe";
import {
  type getDb,
  ensureMembersStripeColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
} from "./db";
import { computeRenewalChargePrice } from "./renewal-pricing";
import { extendSubscriptionAfterRenewal } from "./renewal-extension";
import { loadActiveMonthlySubscription, parsePriceToCents } from "./money-owed-renewal-load";
import { computeCcFee } from "./cc-fees";
import { stripeCustomerIdForApi } from "./stripe-customer";
import {
  resolveStripeCustomerCardPaymentMethodId,
  getOffSessionRenewalBlockerIfResolvedPmIsNull,
  stripeFailureFieldsFromError,
} from "./stripe-customer-payment-method";

type AppDb = ReturnType<typeof getDb>;

export type RetryRenewalResult =
  | { ok: true; message: string; payment_intent_id: string }
  | { ok: false; status: number; error: string };

export async function retryMonthlyRenewalPayment(
  db: AppDb,
  tz: string,
  memberId: string,
  subscriptionId: string | null
): Promise<RetryRenewalResult> {
  ensurePaymentFailuresTable(db);
  ensureMembersStripeColumn(db);
  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);

  const memberRow = db
    .prepare("SELECT stripe_customer_id, email, first_name FROM members WHERE member_id = ?")
    .get(memberId) as { stripe_customer_id: string | null; email: string | null; first_name: string | null } | undefined;
  if (!memberRow) {
    return { ok: false, status: 400, error: "Member not found" };
  }

  const sub = loadActiveMonthlySubscription(db, memberId, subscriptionId);
  if (!sub) {
    return {
      ok: false,
      status: 400,
      error: "No active monthly subscription found to renew.",
    };
  }

  const priceStr = computeRenewalChargePrice(sub.plan_price, {
    sub_price: sub.sub_price,
    promo_renewals_remaining: sub.promo_renewals_remaining,
    renewal_price_indefinite: sub.renewal_price_indefinite,
    renewal_discount_percent: sub.renewal_discount_percent ?? null,
  });
  const amountCents = parsePriceToCents(priceStr) * Math.max(1, Number(sub.quantity) || 1);
  const itemTotalDollars = amountCents / 100;
  if (itemTotalDollars <= 0) {
    return { ok: false, status: 400, error: "Invalid renewal amount" };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return { ok: false, status: 500, error: "Stripe not configured" };
  }

  const stripeCustomerId = stripeCustomerIdForApi(memberRow.stripe_customer_id);
  if (!stripeCustomerId) {
    return { ok: false, status: 400, error: "Add a payment method on your membership page first." };
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

  const paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
  if (!paymentMethodId) {
    const blocker = await getOffSessionRenewalBlockerIfResolvedPmIsNull(stripe, stripeCustomerId);
    if (blocker) {
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, blocker.message, blocker.code);
      return { ok: false, status: 400, error: blocker.message };
    }
  }

  try {
    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: chargeCents,
      currency: "usd",
      customer: stripeCustomerId,
      off_session: true,
      confirm: true,
      description: `Renewal (retry): ${sub.plan_name}`,
      metadata: {
        member_id: sub.member_id,
        subscription_id: sub.subscription_id,
        type: "renewal_retry",
      },
    };
    if (paymentMethodId) {
      piParams.payment_method = paymentMethodId;
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);

    if (paymentIntent.status !== "succeeded") {
      const lastError = paymentIntent.last_payment_error;
      const reasonText = (lastError?.message ?? "").trim() || `Payment status: ${paymentIntent.status}`;
      const stripeCode = lastError?.decline_code ?? lastError?.code ?? null;
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, reasonText, stripeCode);
      return { ok: false, status: 400, error: reasonText };
    }

    await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
      grandTotal: String(totalDollars),
      taxAmount: String(taxDollars),
      itemTotal: String(itemTotalDollars),
      ccFee: String(ccFeeDollars),
      saleType: "renewal",
      stripePaymentIntentId: paymentIntent.id,
    });

    return {
      ok: true,
      message: "Payment succeeded — your membership is extended.",
      payment_intent_id: paymentIntent.id,
    };
  } catch (err) {
    const { message, stripe_error_code } = stripeFailureFieldsFromError(err);
    try {
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, message, stripe_error_code);
    } catch {
      /* ignore */
    }
    return { ok: false, status: 400, error: message };
  }
}
