import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST: create a Stripe Checkout setup session so the member can add/update their payment method (card or ACH). */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });

    const db = getDb();
    ensureMembersStripeColumn(db);
    const row = db.prepare("SELECT email, stripe_customer_id FROM members WHERE member_id = ?").get(memberId) as
      | { email: string | null; stripe_customer_id: string | null }
      | undefined;
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
    const successUrl = `${base}/member/membership?card_updated=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/member/membership`;

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card", "us_bank_account"],
      currency: "usd",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { member_id: memberId },
    };

    const existingCustomerId = row.stripe_customer_id?.trim();
    if (existingCustomerId) {
      params.customer = existingCustomerId;
    } else if (row.email?.trim()) {
      params.customer_email = row.email.trim();
    } else {
      return NextResponse.json({ error: "Member has no email; add email in profile first" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create(params);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start update" }, { status: 500 });
  }
}
