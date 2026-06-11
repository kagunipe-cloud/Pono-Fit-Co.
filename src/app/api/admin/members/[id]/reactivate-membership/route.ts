import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  ensureMembersAutoRenewColumn,
  ensureMembersStripeColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
  ensureSubscriptionPassPackColumns,
} from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { extendSubscriptionAfterRenewal } from "@/lib/renewal-extension";
import { computeRenewalChargePrice } from "@/lib/renewal-pricing";
import {
  loadActiveMonthlySubscription,
  loadLatestCancelledMonthlySubscription,
  parsePriceToCents,
} from "@/lib/money-owed-renewal-load";
import { computeCcFee } from "@/lib/cc-fees";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import {
  resolveStripeCustomerCardPaymentMethodId,
  getOffSessionRenewalBlockerIfResolvedPmIsNull,
  stripeFailureFieldsFromError,
} from "@/lib/stripe-customer-payment-method";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function resolveMemberId(db: ReturnType<typeof getDb>, idParam: string): string | null {
  if (!idParam || idParam.length < 2) return null;
  const isPurelyNumeric = /^\d+$/.test(idParam);
  const row = (
    isPurelyNumeric
      ? db
          .prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?")
          .get(parseInt(idParam, 10), idParam)
      : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(idParam)
  ) as { member_id: string } | undefined;
  return row?.member_id?.trim() || null;
}

/**
 * POST — Admin: reactivate a **cancelled** monthly membership by charging the member’s saved card
 * off-session, then extend one period from the subscription’s last `expiry_date` (same as renewal cron).
 *
 * Body (optional): `{ subscription_id?: string, enable_auto_renew?: boolean }` — default `enable_auto_renew` true.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idParam = (await params).id;
  let body: { subscription_id?: string | null; enable_auto_renew?: boolean } = {};
  const rawText = await request.text();
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  const enableAutoRenew = body.enable_auto_renew !== false;

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureMembersAutoRenewColumn(db);
  ensurePaymentFailuresTable(db);
  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);
  ensureSubscriptionPassPackColumns(db);

  const memberId = resolveMemberId(db, idParam);
  if (!memberId) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const active = loadActiveMonthlySubscription(db, memberId, null);
  if (active) {
    db.close();
    return NextResponse.json(
      {
        error:
          "This member already has an active monthly membership. Cancel or adjust it before reactivating a past one.",
      },
      { status: 400 }
    );
  }

  const sub = loadLatestCancelledMonthlySubscription(db, memberId, body.subscription_id ?? null);
  if (!sub) {
    db.close();
    return NextResponse.json(
      {
        error:
          "No cancelled monthly subscription found to reactivate. Use Add to cart / Sell for a new membership.",
      },
      { status: 404 }
    );
  }

  const memberRow = db
    .prepare(`SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?`)
    .get(memberId) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const tz = getAppTimezone(db);

  if ((sub.complimentary ?? 0) === 1) {
    try {
      db.prepare("UPDATE subscriptions SET status = 'Active' WHERE subscription_id = ?").run(sub.subscription_id);
      await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
        grandTotal: "0",
        taxAmount: "0",
        itemTotal: "0",
        ccFee: "0",
        saleType: "complimentary",
      });
      if (enableAutoRenew) {
        db.prepare("UPDATE members SET auto_renew = 1 WHERE member_id = ?").run(memberId);
      }
      db.close();
      return NextResponse.json({
        ok: true,
        message: "Complimentary membership reactivated — period extended; door access restored if waiver allows.",
        subscription_id: sub.subscription_id,
        auto_renew: enableAutoRenew,
      });
    } catch (err) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      const msg = err instanceof Error ? err.message : "Failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    db.close();
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripeCustomerId = stripeCustomerIdForApi(memberRow.stripe_customer_id);
  if (!stripeCustomerId) {
    db.close();
    return NextResponse.json(
      { error: "Member has no Stripe customer on file. Add a payment method first (e.g. Update payment method)." },
      { status: 400 }
    );
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
    db.close();
    return NextResponse.json({ error: "Invalid renewal amount for this subscription." }, { status: 400 });
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

  try {
    const paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
    if (!paymentMethodId) {
      const blocker = await getOffSessionRenewalBlockerIfResolvedPmIsNull(stripe, stripeCustomerId);
      if (blocker) {
        ensurePaymentFailuresTable(db);
        db.prepare(
          `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, blocker.message, blocker.code);
        db.close();
        return NextResponse.json({ error: blocker.message }, { status: 400 });
      }
    }

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: chargeCents,
      currency: "usd",
      customer: stripeCustomerId,
      off_session: true,
      confirm: true,
      description: `Reactivate membership: ${sub.plan_name}`,
      metadata: { member_id: sub.member_id, subscription_id: sub.subscription_id, type: "membership_reactivate" },
    };
    if (paymentMethodId) {
      piParams.payment_method = paymentMethodId;
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);

    if (paymentIntent.status !== "succeeded") {
      const lastError = (paymentIntent as {
        last_payment_error?: { code?: string; decline_code?: string; message?: string };
      }).last_payment_error;
      const reasonText = (lastError?.message ?? "").trim() || `Payment status: ${paymentIntent.status}`;
      const stripeCode = lastError?.decline_code ?? lastError?.code ?? null;
      ensurePaymentFailuresTable(db);
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, reasonText, stripeCode);
      db.close();
      return NextResponse.json({ error: reasonText }, { status: 400 });
    }

    db.prepare("UPDATE subscriptions SET status = 'Active' WHERE subscription_id = ?").run(sub.subscription_id);

    await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
      grandTotal: String(totalDollars),
      taxAmount: String(taxDollars),
      itemTotal: String(itemTotalDollars),
      ccFee: String(ccFeeDollars),
      saleType: "renewal",
      stripePaymentIntentId: paymentIntent.id,
    });

    if (enableAutoRenew) {
      db.prepare("UPDATE members SET auto_renew = 1 WHERE member_id = ?").run(memberId);
    }

    db.close();
    return NextResponse.json({
      ok: true,
      message: "Payment succeeded — membership reactivated and extended; door access restored if waiver allows.",
      subscription_id: sub.subscription_id,
      payment_intent_id: paymentIntent.id,
      auto_renew: enableAutoRenew,
    });
  } catch (err) {
    try {
      const { message, stripe_error_code } = stripeFailureFieldsFromError(err);
      ensurePaymentFailuresTable(db);
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, message, stripe_error_code);
    } catch (insertErr) {
      console.error("[reactivate-membership] insert payment_failure", insertErr);
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[reactivate-membership]", err);
    const msg = err instanceof Error ? err.message : "Payment failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
