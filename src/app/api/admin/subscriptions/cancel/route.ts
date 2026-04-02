import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { revokeAccess } from "../../../../../lib/kisi";

export const dynamic = "force-dynamic";

/** POST { subscription_id: string } — Admin only. Sets subscription status to Cancelled and revokes Kisi door access. */
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
    const sub = db
      .prepare(
        "SELECT s.subscription_id, s.member_id, m.kisi_id FROM subscriptions s JOIN members m ON m.member_id = s.member_id WHERE s.subscription_id = ?"
      )
      .get(subscription_id) as { subscription_id: string; member_id: string; kisi_id: string | null } | undefined;
    if (!sub) {
      db.close();
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    db.prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run("Cancelled", subscription_id);
    const stillActive = db
      .prepare("SELECT 1 FROM subscriptions WHERE member_id = ? AND status = 'Active' LIMIT 1")
      .get(sub.member_id) as { 1?: number } | undefined;
    db.close();
    const kid = sub.kisi_id?.trim();
    if (kid && !stillActive) {
      try {
        await revokeAccess(kid);
      } catch (e) {
        console.error("[cancel subscription] Kisi revoke failed", e);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}
