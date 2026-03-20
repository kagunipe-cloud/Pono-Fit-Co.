import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../../lib/db";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST: create a Stripe Checkout setup session so the member can add/update their payment method (card or ACH). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const isPurelyNumeric = /^\d+$/.test(id);

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });

    const db = getDb();
    ensureMembersStripeColumn(db);
    let row = (isPurelyNumeric
      ? db.prepare("SELECT member_id, email, stripe_customer_id FROM members WHERE id = ?").get(parseInt(id, 10))
      : null
    ) as { member_id: string; email: string | null; stripe_customer_id: string | null } | undefined;
    if (!row) {
      row = db.prepare("SELECT member_id, email, stripe_customer_id FROM members WHERE member_id = ?").get(id) as
        | { member_id: string; email: string | null; stripe_customer_id: string | null }
        | undefined;
    }
    db.close();
    if (!row) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const stripe = new Stripe(stripeSecret);
    const proto = request.headers.get("x-forwarded-proto");
    const host = request.headers.get("x-forwarded-host");
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      (proto && host ? `${proto}://${host}`.replace(/\/$/, "") : null) ||
      request.headers.get("origin") ||
      request.nextUrl.origin;
    const base = origin.replace(/\/$/, "");
    const successUrl = `${base}/members/${id}?card_updated=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/members/${id}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card", "us_bank_account"],
      currency: "usd",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { member_id: row.member_id },
    };

    const existingCustomerId = row.stripe_customer_id?.trim();
    if (existingCustomerId) {
      sessionParams.customer = existingCustomerId;
    } else if (row.email?.trim()) {
      sessionParams.customer_email = row.email.trim();
    } else {
      return NextResponse.json({ error: "Member has no email; add email first" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start update" }, { status: 500 });
  }
}
