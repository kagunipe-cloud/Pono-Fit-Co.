import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** GET ?payment_intent_id=pi_xxx — Poll PaymentIntent status (admin only). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const paymentIntentId = request.nextUrl.searchParams.get("payment_intent_id")?.trim();
  if (!paymentIntentId) {
    return NextResponse.json({ error: "payment_intent_id required" }, { status: 400 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    // requires_payment_method = waiting for customer to tap (or declined, can retry) — keep polling
    // Only "canceled" is definitive failure; "succeeded" is success
    const status =
      pi.status === "succeeded"
        ? "succeeded"
        : pi.status === "canceled"
          ? "failed"
          : "in_progress";
    return NextResponse.json({ status, payment_intent: pi });
  } catch (err) {
    console.error("[terminal/payment-status]", err);
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 });
  }
}
