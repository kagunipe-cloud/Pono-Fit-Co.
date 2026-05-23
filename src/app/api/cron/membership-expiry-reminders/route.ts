import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  ensureMembersStripeColumn,
  ensureMembersAutoRenewColumn,
  ensureSubscriptionPauseStartedColumn,
} from "../../../../lib/db";
import { formatDateForStorage, todayInAppTz } from "../../../../lib/app-timezone";
import { sendMembershipExpiryReminder } from "../../../../lib/email";
import { hasBillableStripeCustomer } from "../../../../lib/stripe-customer";

export const dynamic = "force-dynamic";

/** GET: find active subscriptions expiring in 2 days and email members. Auto-charge wording only if billable Stripe customer + auto_renew; else renew / opt-in link. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureMembersAutoRenewColumn(db);
  ensureSubscriptionPauseStartedColumn(db);
  const tz = getAppTimezone(db);

  const cronEnabled = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("email_cron_membership_expiry_enabled") as { value: string } | undefined;
  if (cronEnabled?.value?.trim() === "0") {
    db.close();
    return NextResponse.json({
      date: todayInAppTz(tz),
      skipped: true,
      reason: "Membership expiring cron emails are disabled in Admin → Settings → Emails & documents.",
      expiry_target: null,
      count: 0,
      sent: 0,
      results: [] as { member_id: string; email: string; sent: boolean; error?: string }[],
    });
  }

  const excludeRow = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("email_membership_expiry_exclude_auto_renew") as { value: string } | undefined;
  const excludeRaw = excludeRow?.value?.trim() ?? "";
  /** '0' = send to everyone including auto-renew; otherwise (incl. missing key) = skip auto-renew members. */
  const excludeAutoRenew = excludeRaw !== "0";

  /** Date in gym timezone (YYYY-MM-DD) to match expiry_date in DB. */
  const inTwoDays = new Date();
  inTwoDays.setDate(inTwoDays.getDate() + 2);
  const expiryTarget = formatDateForStorage(inTwoDays, tz);

  const expiring = db.prepare(`
    SELECT s.subscription_id, s.member_id, s.expiry_date
    FROM subscriptions s
    WHERE s.status = 'Active' AND s.expiry_date = ?
      AND TRIM(COALESCE(s.subscription_pause_started, '')) = ''
  `).all(expiryTarget) as { subscription_id: string; member_id: string; expiry_date: string }[];

  const results: { member_id: string; email: string; sent: boolean; skipped?: boolean; error?: string }[] = [];

  for (const sub of expiring) {
    const member = db.prepare(
      "SELECT email, first_name, stripe_customer_id, COALESCE(auto_renew, 0) AS auto_renew FROM members WHERE member_id = ?"
    ).get(sub.member_id) as
      | {
          email: string | null;
          first_name: string | null;
          stripe_customer_id: string | null;
          auto_renew: number;
        }
      | undefined;

    const autoRenewOn = Number(member?.auto_renew) === 1;
    if (excludeAutoRenew && autoRenewOn) {
      results.push({
        member_id: sub.member_id,
        email: member?.email?.trim() ?? "",
        sent: false,
        skipped: true,
      });
      continue;
    }

    if (!member?.email?.trim()) {
      results.push({ member_id: sub.member_id, email: "", sent: false, error: "No email" });
      continue;
    }

    const has_card_on_file = hasBillableStripeCustomer(member.stripe_customer_id);
    const auto_renew = autoRenewOn;
    const r = await sendMembershipExpiryReminder({
      to: member.email.trim(),
      first_name: member.first_name,
      expiry_date: sub.expiry_date,
      has_card_on_file,
      auto_renew,
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
  const skippedAutoRenew = results.filter((r) => r.skipped).length;
  return NextResponse.json({
    date: todayInAppTz(tz),
    expiry_target: expiryTarget,
    exclude_auto_renew_members: excludeAutoRenew,
    count: expiring.length,
    sent,
    skipped_auto_renew: skippedAutoRenew,
    results,
  });
}
