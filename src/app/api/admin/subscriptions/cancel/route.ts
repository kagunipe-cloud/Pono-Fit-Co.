import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

/** POST { subscription_id: string } — Admin only. Sets subscription status to Cancelled. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const subscription_id = (body.subscription_id ?? "").trim();
    if (!subscription_id) {
      return NextResponse.json({ error: "subscription_id required" }, { status: 400 });
    }
    const db = getDb();
    const sub = db.prepare("SELECT subscription_id, member_id FROM subscriptions WHERE subscription_id = ?").get(subscription_id) as { subscription_id: string; member_id: string } | undefined;
    if (!sub) {
      db.close();
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    db.prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run("Cancelled", subscription_id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}
