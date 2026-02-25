import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersStripeColumn } from "../../../../lib/db";
import { formatInAppTz } from "../../../../lib/app-timezone";
import { sendMembershipExpiryReminder } from "../../../../lib/email";

export const dynamic = "force-dynamic";

/** GET: find active subscriptions expiring in 2 days and email members. Card on file = remind them they're set; no card = payment due on expiry date. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  const tz = getAppTimezone(db);

  /** Date in gym timezone (e.g. "2/5/2026") to match expiry_date in DB. */
  const dateString = (d: Date) => formatInAppTz(d, { month: "numeric", day: "numeric", year: "numeric" }, tz);

  const inTwoDays = new Date();
  inTwoDays.setDate(inTwoDays.getDate() + 2);
  const expiryTarget = dateString(inTwoDays);

  const expiring = db.prepare(`
    SELECT s.subscription_id, s.member_id, s.expiry_date
    FROM subscriptions s
    WHERE s.status = 'Active' AND s.expiry_date = ?
  `).all(expiryTarget) as { subscription_id: string; member_id: string; expiry_date: string }[];

  const results: { member_id: string; email: string; sent: boolean; error?: string }[] = [];

  for (const sub of expiring) {
    const member = db.prepare(
      "SELECT email, first_name, stripe_customer_id FROM members WHERE member_id = ?"
    ).get(sub.member_id) as { email: string | null; first_name: string | null; stripe_customer_id: string | null } | undefined;

    if (!member?.email?.trim()) {
      results.push({ member_id: sub.member_id, email: "", sent: false, error: "No email" });
      continue;
    }

    const has_card_on_file = !!(member.stripe_customer_id?.trim());
    const r = await sendMembershipExpiryReminder({
      to: member.email.trim(),
      first_name: member.first_name,
      expiry_date: sub.expiry_date,
      has_card_on_file,
    });
    results.push({
      member_id: sub.member_id,
      email: member.email.trim(),
      sent: r.ok,
      error: r.error,
    });
  }

  db.close();

  const sent = results.filter((r) => r.sent).length;
  return NextResponse.json({
    date: dateString(new Date()),
    expiry_target: expiryTarget,
    count: expiring.length,
    sent,
    results,
  });
}
