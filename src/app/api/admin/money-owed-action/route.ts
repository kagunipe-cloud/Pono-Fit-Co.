import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  ensureMembersStripeColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
  clearPaymentFailuresAfterSubscriptionRenewal,
  deleteMoneyOwedReminderForGroup,
} from "@/lib/db";
import { computeRenewalChargePrice } from "@/lib/renewal-pricing";
import { getAdminMemberId } from "@/lib/admin";
import { extendSubscriptionAfterRenewal } from "@/lib/renewal-extension";
import {
  loadActiveMonthlySubscription,
  normalizeSubscriptionKey,
  parsePriceToCents,
} from "@/lib/money-owed-renewal-load";
import { computeCcFee } from "@/lib/cc-fees";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import {
  resolveStripeCustomerCardPaymentMethodId,
  stripeFailureFieldsFromError,
} from "@/lib/stripe-customer-payment-method";
import { revokeAccess } from "@/lib/kisi";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

type AppDb = ReturnType<typeof getDb>;

function deleteFailureGroup(db: AppDb, memberId: string, subscriptionKey: string) {
  clearPaymentFailuresAfterSubscriptionRenewal(db, memberId, subscriptionKey);
}

function dismissFailureGroup(db: AppDb, memberId: string, subscriptionKey: string) {
  db.prepare(
    `UPDATE payment_failures SET dismissed_at = datetime('now')
     WHERE member_id = ? AND COALESCE(subscription_id, '') = ?
       AND (dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = '')`
  ).run(memberId, subscriptionKey);
  deleteMoneyOwedReminderForGroup(db, memberId, subscriptionKey);
}

/** Same outcome as POST /api/admin/subscriptions/cancel — stops cron renewals for that membership. */
async function cancelActiveSubscriptionForMoneyOwed(
  db: AppDb,
  row: { subscription_id: string; member_id: string; kisi_id: string | null }
): Promise<void> {
  db.prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run("Cancelled", row.subscription_id);
  const stillActive = db
    .prepare("SELECT 1 FROM subscriptions WHERE member_id = ? AND status = 'Active' LIMIT 1")
    .get(row.member_id) as { 1?: number } | undefined;
  const kid = row.kisi_id?.trim();
  if (kid && !stillActive) {
    try {
      await revokeAccess(kid);
    } catch (e) {
      console.error("[money-owed-action cancel_subscription] Kisi revoke failed", e);
    }
  }
}

/**
 * POST — action on all failed attempts for one member + subscription (cron retries grouped).
 * Body: `{ action, id?: number }` (legacy: any failure row id in the group) or
 * `{ action, member_id: string, subscription_id?: string | null }`.
 *
 * Actions: `retry_payment`, `write_off`, `cancel_subscription`, `dismiss` (archive open row only — no Stripe/membership change).
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; id?: number; member_id?: string; subscription_id?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  if (!["cancel_subscription", "retry_payment", "write_off", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const db = getDb();
  ensurePaymentFailuresTable(db);
  ensureMembersStripeColumn(db);
  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);
  const tz = getAppTimezone(db);

  let memberId: string;
  let subscriptionKey: string;

  const mid = body.member_id != null ? String(body.member_id).trim() : "";
  if (mid) {
    memberId = mid;
    subscriptionKey = normalizeSubscriptionKey(body.subscription_id ?? null);
  } else {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id < 1) {
      db.close();
      return NextResponse.json({ error: "Provide id or member_id" }, { status: 400 });
    }
    const failure = db
      .prepare(
        `SELECT id, member_id, subscription_id, dismissed_at FROM payment_failures WHERE id = ?`
      )
      .get(id) as
      | {
          id: number;
          member_id: string;
          subscription_id: string | null;
          dismissed_at: string | null;
        }
      | undefined;

    if (!failure || failure.dismissed_at) {
      db.close();
      return NextResponse.json({ error: "Record not found or already archived" }, { status: 404 });
    }
    memberId = failure.member_id;
    subscriptionKey = normalizeSubscriptionKey(failure.subscription_id);
  }

  const openCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM payment_failures
       WHERE member_id = ? AND COALESCE(subscription_id, '') = ?
         AND (dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = '')`
    )
    .get(memberId, subscriptionKey) as { c: number } | undefined;

  if (!openCount || openCount.c < 1) {
    db.close();
    return NextResponse.json({ error: "No open failed payments for this member/subscription" }, { status: 404 });
  }

  if (action === "dismiss") {
    dismissFailureGroup(db, memberId, subscriptionKey);
    db.close();
    return NextResponse.json({
      ok: true,
      message:
        "Dismissed — this balance no longer appears on the open list. Stripe and the membership were not changed. Find it under Archived if you need history.",
    });
  }

  if (action === "cancel_subscription") {
    const sidToCancel =
      subscriptionKey !== ""
        ? subscriptionKey
        : (loadActiveMonthlySubscription(db, memberId, null)?.subscription_id ?? null);

    let cancelled = false;
    if (sidToCancel) {
      const activeRow = db
        .prepare(
          `SELECT s.subscription_id, s.member_id, m.kisi_id
           FROM subscriptions s
           JOIN members m ON m.member_id = s.member_id
           WHERE s.subscription_id = ? AND s.member_id = ? AND s.status = 'Active'`
        )
        .get(sidToCancel, memberId) as
        | { subscription_id: string; member_id: string; kisi_id: string | null }
        | undefined;
      if (activeRow) {
        try {
          await cancelActiveSubscriptionForMoneyOwed(db, activeRow);
          cancelled = true;
        } catch (e) {
          db.close();
          const msg = e instanceof Error ? e.message : "Failed to cancel membership";
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }
    }

    dismissFailureGroup(db, memberId, subscriptionKey);
    db.close();
    return NextResponse.json({
      ok: true,
      message: cancelled
        ? "Balance archived; membership cancelled so automatic renewals stop. Door access is revoked if they have no other active membership."
        : "Balance archived. No active monthly subscription was matched to cancel (cron renewals were already not running for that case).",
    });
  }

  const memberRow = db
    .prepare(`SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?`)
    .get(memberId) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  const sub = loadActiveMonthlySubscription(db, memberId, subscriptionKey === "" ? null : subscriptionKey);
  if (!sub) {
    db.close();
    return NextResponse.json(
      { error: "No active monthly subscription found for this member. Restore or create a membership before retrying or writing off." },
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

  /** Set false only after a successful PI — if extend throws after charge, do not log a new failure row. */
  let retryFailureStillPreRenewal = action === "retry_payment";
  /** Amount (incl. fee/tax) for `payment_failures` when a retry fails before renewal is recorded. */
  let recordRetryFailureCents: number | undefined;

  try {
    if (action === "write_off") {
      await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
        grandTotal: "0",
        taxAmount: "0",
        itemTotal: "0",
        ccFee: "0",
        saleType: "complimentary",
      });
      db.close();
      return NextResponse.json({ ok: true, message: "Written off — membership extended; door access restored if waiver allows." });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeSecret) {
      db.close();
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const stripeCustomerId = stripeCustomerIdForApi(memberRow.stripe_customer_id);
    if (!stripeCustomerId) {
      db.close();
      return NextResponse.json({ error: "Member has no Stripe customer ID. Add a card on file first." }, { status: 400 });
    }

    const itemTotalDollars = amountCents / 100;
    if (itemTotalDollars <= 0) {
      db.close();
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
    recordRetryFailureCents = chargeCents;

    const paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: chargeCents,
      currency: "usd",
      customer: stripeCustomerId,
      off_session: true,
      confirm: true,
      description: `Renewal (retry): ${sub.plan_name}`,
      metadata: { member_id: sub.member_id, subscription_id: sub.subscription_id, type: "renewal_retry" },
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
      db.prepare(
        `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, reasonText, stripeCode);
      db.close();
      return NextResponse.json({ error: reasonText }, { status: 400 });
    }

    retryFailureStillPreRenewal = false;

    await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
      grandTotal: String(totalDollars),
      taxAmount: String(taxDollars),
      itemTotal: String(itemTotalDollars),
      ccFee: String(ccFeeDollars),
      saleType: "renewal",
      stripePaymentIntentId: paymentIntent.id,
    });
    db.close();
    return NextResponse.json({ ok: true, message: "Payment succeeded — membership extended; door access restored if waiver allows." });
  } catch (err) {
    if (
      action === "retry_payment" &&
      retryFailureStillPreRenewal &&
      recordRetryFailureCents != null
    ) {
      try {
        const { message, stripe_error_code } = stripeFailureFieldsFromError(err);
        ensurePaymentFailuresTable(db);
        db.prepare(
          `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          sub.member_id,
          sub.subscription_id,
          sub.plan_name,
          recordRetryFailureCents,
          message,
          stripe_error_code
        );
      } catch (insertErr) {
        console.error("[money-owed-action] insert retry failure row", insertErr);
      }
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[money-owed-action]", err);
    const msg = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
