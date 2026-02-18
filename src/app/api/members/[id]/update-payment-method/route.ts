import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../../lib/db";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST: create a Stripe Checkout setup session so the member can add/update their card on file (admin or member context). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const numericId = parseInt(id, 10);
    const isNumeric = !Number.isNaN(numericId);

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });

    const db = getDb();
    ensureMembersStripeColumn(db);
    let row = (isNumeric
      ? db.prepare("SELECT member_id, email, stripe_customer_id FROM members WHERE id = ?").get(numericId)
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
    const origin = request.headers.get("origin") ?? request.nextUrl.origin;
    const successUrl = `${origin}/members/${id}?card_updated=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/members/${id}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card"],
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
