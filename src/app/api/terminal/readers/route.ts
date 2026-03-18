import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** GET — List Stripe Terminal readers (admin only). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const readers = await stripe.terminal.readers.list({ limit: 20 });
    return NextResponse.json({
      readers: readers.data.map((r) => ({
        id: r.id,
        label: r.label ?? r.device_type ?? r.id,
        status: r.status,
      })),
    });
  } catch (err) {
    console.error("[terminal/readers]", err);
    return NextResponse.json({ error: "Failed to list readers" }, { status: 500 });
  }
}
