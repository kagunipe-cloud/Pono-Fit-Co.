import type { getDb } from "./db";
import { ensureMembersStripeColumn, ensurePaymentFailuresTable } from "./db";
import { ensurePTSlotTables } from "./pt-slots";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "./recurring-classes";
import { ensureRetailProductsTable, assertRetailStockForCart } from "./retail-products";
import { stripeCustomerIdForApi } from "./stripe-customer";
import { computeCartChargeTotals } from "./cart-charge-totals";
import { chargeCartOffSession } from "./cart-off-session-charge";
import {
  ensureScheduledCartChargesTable,
  parseCartSnapshot,
  restoreCartFromSnapshot,
  clearMemberCartItems,
  type ScheduledCartChargeRow,
} from "./scheduled-cart-charge";
import {
  readScheduledChargeAutoRetryState,
  recordScheduledChargeAutoRetryFailure,
  shouldRunAutoCardRetry,
  sendAutoRetryExhaustedStaffEmail,
  markScheduledChargeAutoRetryStaffNotified,
  clearScheduledChargeAutoRetryState,
} from "./card-retry-cadence";
import { stripeFailureFieldsFromError } from "./stripe-customer-payment-method";
import Stripe from "stripe";

function cartHasMonthlyMembership(db: ReturnType<typeof getDb>, snapshot: ReturnType<typeof parseCartSnapshot>): boolean {
  for (const it of snapshot) {
    if (it.product_type !== "membership_plan") continue;
    const plan = db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(it.product_id) as { unit: string } | undefined;
    if (plan?.unit === "Month") return true;
  }
  return false;
}

export type ProcessScheduledResult =
  | { status: "completed"; payment_intent_id: string }
  | { status: "failed"; message: string }
  | { status: "skipped"; message: string };

export async function processOneScheduledCartCharge(params: {
  db: ReturnType<typeof getDb>;
  row: ScheduledCartChargeRow;
  stripe: Stripe;
  stripeSecret: string;
  todayYmd: string;
  confirmPaymentBaseUrl: string;
  cronSecret: string;
  /** Staff “retry now” bypasses auto retry cadence and exhausted flag. */
  bypassRetryCadence?: boolean;
}): Promise<ProcessScheduledResult> {
  const { db, row, stripe, stripeSecret, todayYmd, confirmPaymentBaseUrl, cronSecret, bypassRetryCadence } = params;

  if (row.status === "awaiting_card") {
    return { status: "skipped", message: "Awaiting saved payment method" };
  }
  if (row.status === "completed") {
    return { status: "skipped", message: "Already completed" };
  }
  if (row.charge_on_ymd > todayYmd) {
    return { status: "skipped", message: "Not due yet" };
  }

  const retryState = readScheduledChargeAutoRetryState(row);
  if (!bypassRetryCadence && !shouldRunAutoCardRetry(todayYmd, retryState)) {
    if (retryState.exhausted) {
      return { status: "skipped", message: "Auto card retry exhausted — flagged in Money owed" };
    }
    return { status: "skipped", message: `Next auto card retry scheduled for ${retryState.next_attempt_ymd}` };
  }

  if (row.last_attempt_ymd === todayYmd && row.status === "failed" && bypassRetryCadence) {
    /* staff retry same day — allow */
  } else if (row.last_attempt_ymd === todayYmd && row.status === "failed") {
    return { status: "skipped", message: "Already attempted today" };
  }

  async function recordScheduledFailure(
    msg: string,
    amountCents: number | null,
    stripeCode: string | null
  ): Promise<void> {
    ensurePaymentFailuresTable(db);
    db.prepare(
      `INSERT INTO payment_failures (member_id, subscription_id, plan_name, amount_cents, reason, stripe_error_code)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      row.member_id,
      `scheduled:${row.id}`,
      `Scheduled cart (${row.charge_on_ymd})`,
      amountCents,
      msg,
      stripeCode
    );
    const memberRow = db
      .prepare("SELECT email, first_name FROM members WHERE member_id = ?")
      .get(row.member_id) as { email: string | null; first_name: string | null } | undefined;
    if (!bypassRetryCadence) {
      const newState = recordScheduledChargeAutoRetryFailure(db, row.id, todayYmd, retryState);
      if (newState.exhausted && !retryState.staff_notified) {
        const memberName =
          [memberRow?.first_name?.trim(), memberRow?.email?.trim()].filter(Boolean).join(" — ") || row.member_id;
        await sendAutoRetryExhaustedStaffEmail({
          kind: "scheduled_cart",
          memberName,
          memberEmail: memberRow?.email ?? null,
          memberId: row.member_id,
          label: `Scheduled cart (${row.charge_on_ymd})`,
          amountDollars: amountCents != null ? `$${(amountCents / 100).toFixed(2)}` : "—",
          lastReason: msg,
        });
        markScheduledChargeAutoRetryStaffNotified(db, row.id);
      }
    }
  }

  ensureScheduledCartChargesTable(db);
  ensureMembersStripeColumn(db);
  ensurePTSlotTables(db);
  ensureRecurringClassesTables(db);
  ensureClassesRecurringColumns(db);
  ensureClassOccurrencesClassId(db);
  ensureRetailProductsTable(db);

  const snapshot = parseCartSnapshot(row.cart_snapshot_json);
  if (snapshot.length === 0) {
    db.prepare("UPDATE scheduled_cart_charges SET status = 'cancelled', last_error = ? WHERE id = ?").run(
      "Empty cart snapshot",
      row.id
    );
    return { status: "skipped", message: "Empty snapshot" };
  }

  restoreCartFromSnapshot(db, row.member_id, snapshot, row.promo_code);
  const cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(row.member_id) as { id: number };
  try {
    assertRetailStockForCart(db, cart.id, { skipRetailStock: false });
  } catch (stockErr) {
    clearMemberCartItems(db, row.member_id);
    const msg = stockErr instanceof Error ? stockErr.message : "Insufficient stock";
    db.prepare(
      `UPDATE scheduled_cart_charges SET status = 'failed', last_error = ?, last_attempt_ymd = ? WHERE id = ?`
    ).run(msg, todayYmd, row.id);
    await recordScheduledFailure(msg, null, null);
    return { status: "failed", message: msg };
  }

  const totals = await computeCartChargeTotals(db, snapshot, row.promo_code, stripeSecret);
  const hasMonthly = cartHasMonthlyMembership(db, snapshot);

  const memberRow = db
    .prepare("SELECT stripe_customer_id FROM members WHERE member_id = ?")
    .get(row.member_id) as { stripe_customer_id: string | null } | undefined;
  const stripeCustomerId = stripeCustomerIdForApi(memberRow?.stripe_customer_id);
  if (!stripeCustomerId) {
    clearMemberCartItems(db, row.member_id);
    const msg = "No Stripe customer on file";
    db.prepare(
      `UPDATE scheduled_cart_charges SET status = 'failed', last_error = ?, last_attempt_ymd = ? WHERE id = ?`
    ).run(msg, todayYmd, row.id);
    await recordScheduledFailure(msg, totals.amountCents, null);
    return { status: "failed", message: msg };
  }

  const charge = await chargeCartOffSession({
    stripe,
    stripeCustomerId,
    amountCents: totals.amountCents,
    member_id: row.member_id,
    taxDollars: totals.taxDollars,
    hasMonthlyMembershipInCart: hasMonthly,
    monthly_recurring: row.monthly_recurring !== 0,
    promoCode: totals.promoCode,
    scheduled_cart_charge_id: row.id,
    staffInitiated: true,
  });

  if (!charge.ok) {
    clearMemberCartItems(db, row.member_id);
    db.prepare(
      `UPDATE scheduled_cart_charges SET status = 'failed', last_error = ?, last_attempt_ymd = ? WHERE id = ?`
    ).run(charge.error, todayYmd, row.id);
    await recordScheduledFailure(charge.error, totals.amountCents, charge.stripe_error_code ?? null);
    return { status: "failed", message: charge.error };
  }

  try {
    const confirmRes = await fetch(`${confirmPaymentBaseUrl.replace(/\/$/, "")}/api/cart/confirm-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
      },
      body: JSON.stringify({
        member_id: row.member_id,
        payment_intent_id: charge.payment_intent_id,
      }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) {
      const msg =
        typeof confirmData.error === "string" ? confirmData.error : `Fulfillment failed (${confirmRes.status})`;
      db.prepare(
        `UPDATE scheduled_cart_charges SET last_error = ?, last_attempt_ymd = ?, payment_intent_id = ? WHERE id = ?`
      ).run(msg, todayYmd, charge.payment_intent_id, row.id);
      console.error("[scheduled-cart-charge] Paid but confirm failed:", row.id, msg);
      return { status: "failed", message: msg };
    }

    db.prepare(
      `UPDATE scheduled_cart_charges SET status = 'completed', completed_at = datetime('now'), last_error = NULL, last_attempt_ymd = ?, payment_intent_id = ? WHERE id = ?`
    ).run(todayYmd, charge.payment_intent_id, row.id);
    ensurePaymentFailuresTable(db);
    db.prepare(`DELETE FROM payment_failures WHERE member_id = ? AND subscription_id = ?`).run(
      row.member_id,
      `scheduled:${row.id}`
    );
    clearScheduledChargeAutoRetryState(db, row.id);
    return { status: "completed", payment_intent_id: charge.payment_intent_id };
  } catch (err) {
    const { message: msg } = stripeFailureFieldsFromError(err);
    db.prepare(
      `UPDATE scheduled_cart_charges SET last_error = ?, last_attempt_ymd = ?, payment_intent_id = ? WHERE id = ?`
    ).run(msg, todayYmd, charge.payment_intent_id, row.id);
    console.error("[scheduled-cart-charge] confirm fetch error:", row.id, err);
    return { status: "failed", message: msg };
  }
}
