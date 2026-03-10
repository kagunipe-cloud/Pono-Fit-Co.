import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, ensureSalesStripePaymentIntentColumn } from "@/lib/db";
import { revokeAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook for ACH payment failures.
 * When an ACH payment fails (bounces), we revoke door access and cancel the subscription.
 *
 * Set up in Stripe Dashboard: Developers → Webhooks → Add endpoint
 * URL: https://your-app.com/api/stripe/webhook
 * Events: payment_intent.payment_failed
 * Copy the signing secret to STRIPE_WEBHOOK_SECRET in env.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[Stripe webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[Stripe webhook] Failed to read body:", err);
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    console.error("[Stripe webhook] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Stripe webhook] Signature verification failed:", msg);
    return NextResponse.json({ error: `Webhook Error: ${msg}` }, { status: 400 });
  }

  if (event.type !== "payment_intent.payment_failed") {
    return NextResponse.json({ received: true });
  }

  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentIntentId = pi.id;

  const db = getDb();
  ensureSalesStripePaymentIntentColumn(db);

  const sale = db.prepare(
    "SELECT sales_id, member_id FROM sales WHERE stripe_payment_intent_id = ? AND status = 'Paid'"
  ).get(paymentIntentId) as { sales_id: string; member_id: string } | undefined;

  if (!sale) {
    db.close();
    console.log("[Stripe webhook] No sale found for payment_intent:", paymentIntentId);
    return NextResponse.json({ received: true });
  }

  try {
    db.exec("BEGIN TRANSACTION");

    db.prepare("UPDATE sales SET status = ? WHERE sales_id = ?").run("Payment Failed", sale.sales_id);
    db.prepare("UPDATE subscriptions SET status = ? WHERE sales_id = ?").run("Cancelled", sale.sales_id);

    const memberRow = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(sale.member_id) as {
      kisi_id: string | null;
    } | undefined;
    const kisiId = memberRow?.kisi_id?.trim();

    db.exec("COMMIT");
    db.close();

    if (kisiId) {
      try {
        await revokeAccess(kisiId);
        console.log("[Stripe webhook] Revoked Kisi access for member:", sale.member_id, "after ACH failure");
      } catch (e) {
        console.error("[Stripe webhook] Kisi revoke failed:", e);
      }
    }
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    console.error("[Stripe webhook] Failed to process:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
