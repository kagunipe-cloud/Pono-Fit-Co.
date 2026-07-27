import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, getAppTimezone, ensureMembersStripeColumn } from "@/lib/db";
import { ensureCartTables } from "@/lib/cart";
import { getTrainerMemberId } from "@/lib/admin";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "@/lib/recurring-classes";
import { ensureRetailProductsTable, assertRetailStockForCart } from "@/lib/retail-products";
import { todayInAppTz } from "@/lib/app-timezone";
import { stripeCustomerIdForApi } from "@/lib/stripe-customer";
import { resolveStripeCustomerCardPaymentMethodId } from "@/lib/stripe-customer-payment-method";
import {
  ensureScheduledCartChargesTable,
  snapshotCartItems,
  normalizeChargeOnYmd,
  suggestedChargeOnFromSnapshot,
  getActiveScheduledChargeForMember,
  clearMemberCartItems,
  parseCartSnapshot,
  restoreCartFromSnapshot,
  type ScheduledCartChargeRow,
} from "@/lib/scheduled-cart-charge";
import { processOneScheduledCartCharge } from "@/lib/process-scheduled-cart-charge";

export const dynamic = "force-dynamic";

function requestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    (proto && host ? `${proto}://${host}`.replace(/\/$/, "") : null) ||
    request.headers.get("origin")?.replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

/** POST — Staff: snapshot whole cart and charge saved card on `charge_on_ymd` (or save card first via Checkout setup). */
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
  const member_id = String(body.member_id ?? "").trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureCartTables(db);
  ensureScheduledCartChargesTable(db);
  ensureMembersStripeColumn(db);
  ensureRecurringClassesTables(db);
  ensureClassesRecurringColumns(db);
  ensureClassOccurrencesClassId(db);
  ensurePTSlotTables(db);
  ensureRetailProductsTable(db);

  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);

  const existing = getActiveScheduledChargeForMember(db, member_id);
  if (existing) {
    db.close();
    return NextResponse.json(
      {
        error: `This member already has a scheduled charge (${existing.status}, due ${existing.charge_on_ymd}). Cancel it first or wait until it completes.`,
        scheduled_id: existing.id,
      },
      { status: 409 }
    );
  }

  const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as
    | { id: number; promo_code?: string | null }
    | undefined;
  if (!cart) {
    db.close();
    return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
  }

  const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as Parameters<
    typeof snapshotCartItems
  >[0];
  if (rawItems.length === 0) {
    db.close();
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  try {
    assertRetailStockForCart(db, cart.id, { skipRetailStock: false });
  } catch (stockErr) {
    db.close();
    return NextResponse.json(
      { error: stockErr instanceof Error ? stockErr.message : "Insufficient stock" },
      { status: 409 }
    );
  }

  const snapshot = snapshotCartItems(rawItems);
  let chargeOn = normalizeChargeOnYmd(body.charge_on_ymd, tz);
  if (!chargeOn) {
    chargeOn = suggestedChargeOnFromSnapshot(snapshot, tz);
  }
  if (!chargeOn) {
    db.close();
    return NextResponse.json(
      { error: "charge_on_ymd required (today or a future date, gym calendar). Set a membership start date or pick a charge date." },
      { status: 400 }
    );
  }

  let hasMonthlyMembershipInCart = false;
  for (const it of rawItems) {
    if (it.product_type !== "membership_plan") continue;
    const plan = db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(it.product_id) as { unit: string } | undefined;
    if (plan?.unit === "Month") hasMonthlyMembershipInCart = true;
  }

  const monthly_recurring_body = body.monthly_recurring as boolean | undefined;
  const monthlyRecurring = monthly_recurring_body !== false ? 1 : 0;

  if (hasMonthlyMembershipInCart && monthlyRecurring === 1) {
    const memberEmail = db.prepare("SELECT email FROM members WHERE member_id = ?").get(member_id) as
      | { email: string | null }
      | undefined;
    if (!memberEmail?.email?.trim()) {
      db.close();
      return NextResponse.json(
        { error: "Member needs an email on file for monthly auto-renew on the scheduled charge." },
        { status: 400 }
      );
    }
  }

  const memberRow = db
    .prepare("SELECT email, stripe_customer_id FROM members WHERE member_id = ?")
    .get(member_id) as { email: string | null; stripe_customer_id: string | null } | undefined;

  const promo = cart.promo_code?.trim() || null;
  const snapshotJson = JSON.stringify(snapshot);

  const stripe = new Stripe(stripeSecret);
  const stripeCustomerId = stripeCustomerIdForApi(memberRow?.stripe_customer_id);
  let paymentMethodId: string | null = null;
  if (stripeCustomerId) {
    paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
  }

  const status = paymentMethodId ? "pending" : "awaiting_card";
  const insert = db
    .prepare(
      `INSERT INTO scheduled_cart_charges (member_id, charge_on_ymd, status, cart_snapshot_json, promo_code, monthly_recurring)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(member_id, chargeOn, status, snapshotJson, promo, monthlyRecurring);
  const scheduledId = Number(insert.lastInsertRowid);

  clearMemberCartItems(db, member_id);

  if (!paymentMethodId) {
    const em = memberRow?.email?.trim();
    if (!em) {
      db.prepare("UPDATE scheduled_cart_charges SET status = 'cancelled', last_error = ? WHERE id = ?").run(
        "No email for Checkout",
        scheduledId
      );
      db.close();
      return NextResponse.json({ error: "Member has no email; add email before saving a card for scheduled charge." }, { status: 400 });
    }

    const origin = requestOrigin(request);
    const memberRouteId = encodeURIComponent(member_id);
    const successUrl = `${origin}/members/${memberRouteId}/cart?schedule_setup=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/members/${memberRouteId}/cart?schedule_cancelled=1`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card", "us_bank_account"],
      currency: "usd",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        member_id,
        scheduled_cart_charge_id: String(scheduledId),
      },
    };
    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else {
      sessionParams.customer_email = em;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    db.close();
    return NextResponse.json({
      ok: true,
      scheduled_id: scheduledId,
      charge_on_ymd: chargeOn,
      status: "awaiting_card",
      needs_payment_method: true,
      setup_checkout_url: session.url,
      message: "Cart saved. Send the member through Stripe to save a card; the charge will run on the scheduled date.",
    });
  }

  const row = db.prepare("SELECT * FROM scheduled_cart_charges WHERE id = ?").get(scheduledId) as ScheduledCartChargeRow;
  db.close();

  if (chargeOn <= today) {
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    const dbRun = getDb();
    const result = await processOneScheduledCartCharge({
      db: dbRun,
      row,
      stripe,
      stripeSecret,
      todayYmd: today,
      confirmPaymentBaseUrl: requestOrigin(request),
      cronSecret,
    });
    dbRun.close();

    if (result.status === "completed") {
      return NextResponse.json({
        ok: true,
        scheduled_id: scheduledId,
        charged_now: true,
        payment_intent_id: result.payment_intent_id,
        message: "Scheduled charge ran immediately (charge date is today).",
      });
    }
    return NextResponse.json(
      { error: result.message, scheduled_id: scheduledId, status: "failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    scheduled_id: scheduledId,
    charge_on_ymd: chargeOn,
    status: "pending",
    message: `Cart scheduled. Their saved card will be charged on ${chargeOn} (gym time). Failed charges appear in Money owed.`,
  });
}

/** DELETE — Staff cancel active scheduled charge and restore cart snapshot. */
export async function DELETE(request: NextRequest) {
  const staffId = await getTrainerMemberId(request);
  if (!staffId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const member_id = url.searchParams.get("member_id")?.trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureScheduledCartChargesTable(db);
  const row = getActiveScheduledChargeForMember(db, member_id);
  if (!row) {
    db.close();
    return NextResponse.json({ error: "No active scheduled charge" }, { status: 404 });
  }

  const snapshot = parseCartSnapshot(row.cart_snapshot_json);
  if (snapshot.length > 0) {
    restoreCartFromSnapshot(db, member_id, snapshot, row.promo_code);
  }
  db.prepare("UPDATE scheduled_cart_charges SET status = 'cancelled', last_error = 'Cancelled by staff' WHERE id = ?").run(
    row.id
  );
  db.close();
  return NextResponse.json({ ok: true, message: "Scheduled charge cancelled; cart restored." });
}
