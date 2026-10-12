import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensurePaymentFailuresTable } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { retryMonthlyRenewalPayment } from "@/lib/retry-monthly-renewal-payment";
import { normalizeSubscriptionKey } from "@/lib/money-owed-renewal-load";

export const dynamic = "force-dynamic";

/** POST — Member pays an overdue renewal (same as admin Money owed → retry). */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  let subscriptionId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.subscription_id != null && String(body.subscription_id).trim() !== "") {
      subscriptionId = String(body.subscription_id).trim();
    }
  } catch {
    /* optional body */
  }

  const db = getDb();
  ensurePaymentFailuresTable(db);
  const tz = getAppTimezone(db);

  const subKey = normalizeSubscriptionKey(subscriptionId);
  const open = db
    .prepare(
      `SELECT 1 FROM payment_failures
       WHERE member_id = ? AND COALESCE(subscription_id, '') = ?
         AND (dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = '')
       LIMIT 1`
    )
    .get(memberId, subKey) as { 1?: number } | undefined;

  if (!open) {
    const anyOpen = db
      .prepare(
        `SELECT subscription_id FROM payment_failures
         WHERE member_id = ?
           AND (dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = '')
         ORDER BY id DESC LIMIT 1`
      )
      .get(memberId) as { subscription_id: string | null } | undefined;
    if (!anyOpen) {
      db.close();
      return NextResponse.json({ error: "No overdue renewal payment is due." }, { status: 400 });
    }
    subscriptionId = anyOpen.subscription_id;
  }

  const result = await retryMonthlyRenewalPayment(db, tz, memberId, subscriptionId);
  db.close();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
