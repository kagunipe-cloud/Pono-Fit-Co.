import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  ensureMembersStripeColumn,
  ensureMembersAutoRenewColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
} from "../../../../lib/db";
import { computeRenewalChargePrice } from "../../../../lib/renewal-pricing";
import { revokeAccess } from "../../../../lib/kisi";
import { extendSubscriptionAfterRenewal } from "../../../../lib/renewal-extension";
import { todayInAppTz, formatDateForStorage } from "../../../../lib/app-timezone";
import { computeCcFee } from "../../../../lib/cc-fees";
import { stripeCustomerIdForApi } from "../../../../lib/stripe-customer";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePriceToCents(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

async function revokeKisiForMember(db: ReturnType<typeof getDb>, memberId: string): Promise<void> {
  const row = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(memberId) as { kisi_id: string | null } | undefined;
  const kid = row?.kisi_id?.trim();
  if (!kid) return;
  try {
    await revokeAccess(kid);
  } catch (e) {
    console.error("[Kisi] revoke failed for member:", memberId, e);
  }
}

/** Today in gym timezone (YYYY-MM-DD) to match expiry_date in DB. */
function todayString(tz: string): string {
  return todayInAppTz(tz);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureMembersAutoRenewColumn(db);
  ensurePaymentFailuresTable(db);
  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);

  const tz = getAppTimezone(db);
  const insertFailure = db.prepare(`
    INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const today = todayString(tz);
  // Monthly memberships due today or earlier (overdue retries), member opted into auto-renew
  const expiring = db.prepare(`
    SELECT s.subscription_id, s.member_id, s.product_id, s.expiry_date, s.price as sub_price, s.quantity,
           s.promo_renewals_remaining, s.renewal_price_indefinite,
           s.complimentary, s.complimentary_renewals_remaining,
           s.renewal_discount_percent,
           p.plan_name, p.price as plan_price, p.length, p.unit
    FROM subscriptions s
    JOIN membership_plans p ON p.product_id = s.product_id
    JOIN members m ON m.member_id = s.member_id
    WHERE s.status = 'Active' AND p.unit = 'Month'
      AND s.expiry_date <= ?
      AND (m.auto_renew = 1)
  `).all(today) as {
    subscription_id: string;
    member_id: string;
    product_id: string;
    expiry_date: string;
    sub_price: string;
    quantity: number;
    promo_renewals_remaining: number | null;
    renewal_price_indefinite: number | null;
    complimentary: number | null;
    complimentary_renewals_remaining: number | null;
    renewal_discount_percent: number | null;
    plan_name: string;
    plan_price: string;
    length: string;
    unit: string;
  }[];

  const stripe = new Stripe(stripeSecret);
  const results: { member_id: string; status: "renewed" | "skipped" | "error"; message?: string }[] = [];

  for (const sub of expiring) {
    const memberRow = db.prepare("SELECT stripe_customer_id, email, first_name, auto_renew FROM members WHERE member_id = ?").get(sub.member_id) as { stripe_customer_id: string | null; email: string | null; first_name: string | null; auto_renew?: number | null } | undefined;
    if (!memberRow) {
      const priceStr = computeRenewalChargePrice(sub.plan_price, {
        sub_price: sub.sub_price,
        promo_renewals_remaining: sub.promo_renewals_remaining,
        renewal_price_indefinite: sub.renewal_price_indefinite,
        renewal_discount_percent: sub.renewal_discount_percent ?? null,
      });
      const amountCents = parsePriceToCents(priceStr) * Math.max(1, sub.quantity);
      results.push({ member_id: sub.member_id, status: "skipped", message: "Member not found" });
      insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, amountCents, "Member not found", null);
      continue;
    }

    if ((sub.complimentary ?? 0) === 1) {
      try {
        await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
          grandTotal: "0",
          taxAmount: "0",
          itemTotal: "0",
          ccFee: "0",
          saleType: "complimentary",
        });
        results.push({ member_id: sub.member_id, status: "renewed" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ member_id: sub.member_id, status: "error", message: msg });
        insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, 0, msg, null);
      }
      continue;
    }

    const priceStr = computeRenewalChargePrice(sub.plan_price, {
      sub_price: sub.sub_price,
      promo_renewals_remaining: sub.promo_renewals_remaining,
      renewal_price_indefinite: sub.renewal_price_indefinite,
      renewal_discount_percent: sub.renewal_discount_percent ?? null,
    });
    const amountCents = parsePriceToCents(priceStr) * Math.max(1, sub.quantity);
    const stripeCustomerId = stripeCustomerIdForApi(memberRow.stripe_customer_id);
    if (!stripeCustomerId) {
      results.push({ member_id: sub.member_id, status: "error", message: "No saved card" });
      insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, amountCents, "No Stripe customer", null);
      await revokeKisiForMember(db, sub.member_id);
      continue;
    }
    const itemTotalDollars = amountCents / 100;
    if (itemTotalDollars <= 0) {
      results.push({ member_id: sub.member_id, status: "error", message: "Invalid price" });
      insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, amountCents, "Invalid price", null);
      await revokeKisiForMember(db, sub.member_id);
      continue;
    }

    const ccFeeDollars = computeCcFee(itemTotalDollars);
    const baseAmount = itemTotalDollars + ccFeeDollars;
    let taxDollars = 0;
    const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim();
    if (taxRateId) {
      try {
        const taxRate = await stripe.taxRates.retrieve(taxRateId);
        const pct = Number(taxRate.percentage) || 0;
        taxDollars = Math.round(baseAmount * (pct / 100) * 100) / 100;
      } catch {
        /* skip tax if rate unavailable */
      }
    }
    const totalDollars = baseAmount + taxDollars;
    const chargeCents = Math.round(totalDollars * 100);

    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
      });
      const pm = paymentMethods.data[0];
      if (!pm) {
        results.push({ member_id: sub.member_id, status: "error", message: "No payment method on file" });
        insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, "No payment method on file", null);
        await revokeKisiForMember(db, sub.member_id);
        continue;
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: chargeCents,
        currency: "usd",
        customer: stripeCustomerId,
        payment_method: pm.id,
        off_session: true,
        confirm: true,
        description: `Renewal: ${sub.plan_name}`,
        metadata: { member_id: sub.member_id, subscription_id: sub.subscription_id, type: "renewal" },
      });

      if (paymentIntent.status !== "succeeded") {
        const statusMsg = `Payment status: ${paymentIntent.status}`;
        const lastError = (paymentIntent as { last_payment_error?: { code?: string; message?: string } }).last_payment_error;
        const stripeCode = lastError?.code ?? null;
        results.push({ member_id: sub.member_id, status: "error", message: statusMsg });
        insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, chargeCents, lastError?.message || statusMsg, stripeCode);
        await revokeKisiForMember(db, sub.member_id);
        continue;
      }

      await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
        grandTotal: String(totalDollars),
        taxAmount: String(taxDollars),
        itemTotal: String(itemTotalDollars),
        ccFee: String(ccFeeDollars),
        saleType: "renewal",
      });
      results.push({ member_id: sub.member_id, status: "renewed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stripeErr = err as { code?: string; decline_code?: string };
      const stripeCode = stripeErr.decline_code ?? stripeErr.code ?? null;
      results.push({ member_id: sub.member_id, status: "error", message: msg });
      insertFailure.run(sub.member_id, sub.subscription_id, sub.plan_name, amountCents, msg, stripeCode);
      await revokeKisiForMember(db, sub.member_id);
    }
  }

  // End-of-period cancel: auto_renew off, expiry already passed — mark Cancelled and revoke door access.
  const endedNoRenew = db
    .prepare(
      `SELECT s.subscription_id, s.member_id
       FROM subscriptions s
       JOIN members m ON m.member_id = s.member_id
       WHERE s.status = 'Active' AND s.expiry_date < ?
         AND (m.auto_renew = 0 OR m.auto_renew IS NULL)`
    )
    .all(today) as { subscription_id: string; member_id: string }[];
  let cancelledEndOfPeriod = 0;
  for (const row of endedNoRenew) {
    try {
      db.prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run("Cancelled", row.subscription_id);
      const anyActive = db
        .prepare("SELECT 1 FROM subscriptions WHERE member_id = ? AND status = 'Active' LIMIT 1")
        .get(row.member_id) as { 1?: number } | undefined;
      if (!anyActive) {
        await revokeKisiForMember(db, row.member_id);
      }
      cancelledEndOfPeriod++;
    } catch (e) {
      console.error("[renew-subscriptions] end-of-period cancel failed", row.subscription_id, e);
    }
  }

  db.close();

  const renewed = results.filter((r) => r.status === "renewed").length;
  const errors = results.filter((r) => r.status === "error");
  return NextResponse.json({
    date: today,
    expiring_count: expiring.length,
    renewed,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: errors.length,
    cancelled_end_of_period: cancelledEndOfPeriod,
    details: results,
  });
}
