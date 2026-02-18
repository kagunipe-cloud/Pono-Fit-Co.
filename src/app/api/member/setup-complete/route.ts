import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../lib/db";
import { getMemberIdFromSession } from "../../../lib/session";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST body: { session_id }. After Stripe setup-mode checkout, save the Stripe customer id to the member if new. */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const session_id = (body.session_id ?? "").trim();
    if (!session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });

    const stripe = new Stripe(stripeSecret);
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.mode !== "setup") return NextResponse.json({ error: "Not a setup session" }, { status: 400 });
    const metaMemberId = session.metadata?.member_id;
    if (metaMemberId !== memberId) return NextResponse.json({ error: "Session does not match member" }, { status: 403 });

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId) return NextResponse.json({ error: "No customer on session" }, { status: 400 });

    const db = getDb();
    ensureMembersStripeColumn(db);
    db.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(customerId, memberId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to complete setup" }, { status: 500 });
  }
}
