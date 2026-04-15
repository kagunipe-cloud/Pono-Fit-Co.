import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  ensureMembersStripeColumn,
  ensureSalesStripePaymentIntentColumn,
  ensureSubscriptionRenewalPromoColumns,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
} from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { extendSubscriptionAfterRenewal } from "@/lib/renewal-extension";
import { loadActiveMonthlySubscription } from "@/lib/money-owed-renewal-load";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/**
 * POST — After Terminal payment succeeds, record renewal and clear money-owed rows (same as card retry success).
 * Body: { payment_intent_id }
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

  let body: { payment_intent_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payment_intent_id = (body.payment_intent_id ?? "").trim();
  if (!payment_intent_id) {
    return NextResponse.json({ error: "payment_intent_id required" }, { status: 400 });
  }

  const stripe = new Stripe(stripeSecret);
  const pi = await stripe.paymentIntents.retrieve(payment_intent_id, { expand: ["customer"] });
  if (pi.status !== "succeeded") {
    return NextResponse.json(
      { error: `Payment not completed (status: ${pi.status}). Wait for success on the reader, then try again.` },
      { status: 400 }
    );
  }

  if (pi.metadata?.money_owed_renewal !== "1") {
    return NextResponse.json({ error: "This payment is not a money-owed renewal intent." }, { status: 400 });
  }

  const member_id = (pi.metadata.member_id ?? "").trim();
  const subscription_id = (pi.metadata.subscription_id ?? "").trim();
  if (!member_id || !subscription_id) {
    return NextResponse.json({ error: "Payment intent missing member or subscription metadata." }, { status: 400 });
  }

  const db = getDb();
  ensureSalesStripePaymentIntentColumn(db);
  const existing = db
    .prepare(
      `SELECT 1 FROM sales WHERE stripe_payment_intent_id = ? AND member_id = ? LIMIT 1`
    )
    .get(payment_intent_id, member_id) as { 1?: number } | undefined;
  if (existing) {
    db.close();
    return NextResponse.json({ ok: true, message: "Already recorded — renewal was applied." });
  }

  const memberRow = db
    .prepare(`SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?`)
    .get(member_id) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  ensureSubscriptionRenewalPromoColumns(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);
  const tz = getAppTimezone(db);

  const sub = loadActiveMonthlySubscription(db, member_id, subscription_id);
  if (!sub) {
    db.close();
    return NextResponse.json({ error: "No active monthly subscription found for this payment." }, { status: 400 });
  }

  const itemTotal = pi.metadata.item_total ?? "";
  const ccFee = pi.metadata.cc_fee ?? "";
  const taxAmount = pi.metadata.tax_amount ?? "0";
  const grandTotal =
    pi.metadata.grand_total ?? ((pi.amount_received ?? pi.amount) / 100).toFixed(2);

  try {
    await extendSubscriptionAfterRenewal(db, tz, sub, memberRow, {
      grandTotal: String(grandTotal),
      taxAmount: String(taxAmount),
      itemTotal: String(itemTotal || "0"),
      ccFee: String(ccFee || "0"),
      saleType: "renewal",
      stripePaymentIntentId: pi.id,
    });
    db.close();
    return NextResponse.json({
      ok: true,
      message: "Payment recorded — membership extended; door access restored if waiver allows.",
    });
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[money-owed-terminal-complete]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to record renewal" },
      { status: 500 }
    );
  }
}
