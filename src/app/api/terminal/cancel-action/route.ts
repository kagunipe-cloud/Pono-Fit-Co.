import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST — Cancel current reader action (admin only). Body: { reader_id } */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const reader_id = (body.reader_id ?? "").trim();
  if (!reader_id) {
    return NextResponse.json({ error: "reader_id required" }, { status: 400 });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    await stripe.terminal.readers.cancelAction(reader_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[terminal/cancel-action]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel" },
      { status: 500 }
    );
  }
}
