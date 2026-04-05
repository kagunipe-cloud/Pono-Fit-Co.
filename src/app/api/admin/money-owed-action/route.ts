import { NextRequest, NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { getDb, getAppTimezone, ensureMembersStripeColumn, ensurePaymentFailuresTable, ensureSubscriptionRenewalPromoColumns } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { extendSubscriptionAfterRenewal } from "@/lib/renewal-extension";
import { computeCcFee } from "@/lib/cc-fees";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePriceToCents(p: string | null): number {
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
};

function loadActiveMonthlySubscription(
  db: Database,
  memberId: string,
  subscriptionId: string | null | undefined
): RenewalSubRow | null {
  const base = `
    SELECT s.subscription_id, s.member_id, s.expiry_date, s.price as sub_price, s.quantity,
           s.promo_renewals_remaining, s.renewal_price_indefinite,
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
    plan_name: row.plan_name,
    plan_price: row.plan_price,
    length: row.length,
    unit: row.unit,
  };
}

/**
 * POST { action: "dismiss" | "retry_payment" | "write_off", id: payment_failures.id }
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; id?: number };
  try {
    body = (await request.json()) as { action?: string; id?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  const id = Number(body.id);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (!["dismiss", "retry_payment", "write_off"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const db = getDb();
  ensurePaymentFailuresTable(db);
  ensureMembersStripeColumn(db);
  ensureSubscriptionRenewalPromoColumns(db);
  const tz = getAppTimezone(db);

  const failure = db
    .prepare(
      `SELECT id, member_id, subscription_id, plan_name, amount_cents, dismissed_at FROM payment_failures WHERE id = ?`
    )
    .get(id) as
    | {
        id: number;
        member_id: string;
        subscription_id: string | null;
        plan_name: string | null;
        amount_cents: number | null;
        dismissed_at: string | null;
      }
    | undefined;

  if (!failure || failure.dismissed_at) {
    db.close();
    return NextResponse.json({ error: "Record not found or already dismissed" }, { status: 404 });
  }

  if (action === "dismiss") {
    db.prepare(`UPDATE payment_failures SET dismissed_at = datetime('now') WHERE id = ?`).run(id);
    db.close();
    return NextResponse.json({ ok: true });
  }

  const memberRow = db
    .prepare(`SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?`)
    .get(failure.member_id) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  const sub = loadActiveMonthlySubscription(db, failure.member_id, failure.subscription_id);
  if (!sub) {
    db.close();
    return NextResponse.json(
      { error: "No active monthly subscription found for this member. Restore or create a membership before retrying or writing off." },
      { status: 400 }
    );
  }

  const useNegotiatedPrice =
    (sub.promo_renewals_remaining != null && sub.promo_renewals_remaining > 0) || (sub.renewal_price_indefinite ?? 0) === 1;
  const priceStr = useNegotiatedPrice ? sub.sub_price : sub.plan_price;
  const amountCents = parsePriceToCents(priceStr) * Math.max(1, Number(sub.quantity) || 1);

  try {
    if (action === "write_off") {
      await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
        grandTotal: "0",
        taxAmount: "0",
        itemTotal: "0",
        ccFee: "0",
        saleType: "complimentary",
      });
      db.prepare(`DELETE FROM payment_failures WHERE id = ?`).run(id);
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

    const paymentMethods = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" });
    const pm = paymentMethods.data[0];
    if (!pm) {
      db.close();
      return NextResponse.json({ error: "No payment method on file for this customer." }, { status: 400 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: pm.id,
      off_session: true,
      confirm: true,
      description: `Renewal (retry): ${sub.plan_name}`,
      metadata: { member_id: sub.member_id, subscription_id: sub.subscription_id, type: "renewal_retry" },
    });

    if (paymentIntent.status !== "succeeded") {
      const lastError = (paymentIntent as { last_payment_error?: { message?: string } }).last_payment_error;
      db.close();
      return NextResponse.json(
        { error: lastError?.message ?? `Payment status: ${paymentIntent.status}` },
        { status: 400 }
      );
    }

    await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
      grandTotal: String(totalDollars),
      taxAmount: String(taxDollars),
      itemTotal: String(itemTotalDollars),
      ccFee: String(ccFeeDollars),
      saleType: "renewal",
    });
    db.prepare(`DELETE FROM payment_failures WHERE id = ?`).run(id);
    db.close();
    return NextResponse.json({ ok: true, message: "Payment succeeded — membership extended; door access restored if waiver allows." });
  } catch (err) {
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
