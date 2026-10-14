import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { retryMonthlyRenewalPayment } from "@/lib/retry-monthly-renewal-payment";
import { getMemberRenewalPaymentDue } from "@/lib/member-renewal-payment-due";

export const dynamic = "force-dynamic";

/** POST — Member pays an overdue renewal (same as admin Money owed → retry). */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const db = getDb();
  const tz = getAppTimezone(db);

  const due = getMemberRenewalPaymentDue(db, memberId);
  if (!due) {
    db.close();
    return NextResponse.json({ error: "No overdue renewal payment is due." }, { status: 400 });
  }

  let subscriptionId = due.subscription_id;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.subscription_id != null && String(body.subscription_id).trim() !== "") {
      const requested = String(body.subscription_id).trim();
      const dueSub = String(due.subscription_id ?? "").trim();
      if (dueSub && requested !== dueSub) {
        db.close();
        return NextResponse.json({ error: "No overdue renewal payment is due for that membership." }, { status: 400 });
      }
      subscriptionId = requested;
    }
  } catch {
    /* optional body */
  }

  const result = await retryMonthlyRenewalPayment(db, tz, memberId, subscriptionId);
  db.close();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
