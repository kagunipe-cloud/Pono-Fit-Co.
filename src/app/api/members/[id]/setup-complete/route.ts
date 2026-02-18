import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "@/lib/db";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/** POST body: { session_id }. After Stripe setup-mode checkout (e.g. from admin "Change card"), save customer id to member. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    const session_id = (body.session_id ?? "").trim();
    if (!session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });

    const stripe = new Stripe(stripeSecret);
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.mode !== "setup") return NextResponse.json({ error: "Not a setup session" }, { status: 400 });

    const metaMemberId = session.metadata?.member_id as string | undefined;
    if (!metaMemberId) return NextResponse.json({ error: "No member on session" }, { status: 400 });

    const db = getDb();
    ensureMembersStripeColumn(db);
    const numericId = parseInt(id, 10);
    const isNumeric = !Number.isNaN(numericId);
    const member = (isNumeric
      ? db.prepare("SELECT member_id FROM members WHERE id = ?").get(numericId)
      : null
    ) as { member_id: string } | undefined;
    const memberByStr = db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id) as { member_id: string } | undefined;
    const memberId = member?.member_id ?? memberByStr?.member_id;
    if (!memberId || memberId !== metaMemberId) {
      db.close();
      return NextResponse.json({ error: "Member mismatch" }, { status: 403 });
    }

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId) {
      db.close();
      return NextResponse.json({ error: "No customer on session" }, { status: 400 });
    }

    db.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(customerId, memberId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to complete setup" }, { status: 500 });
  }
}
