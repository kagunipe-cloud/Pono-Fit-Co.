import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, getAppTimezone } from "@/lib/db";
import { getTrainerMemberId } from "@/lib/admin";
import { todayInAppTz } from "@/lib/app-timezone";
import {
  ensureScheduledCartChargesTable,
  getActiveScheduledChargeForMember,
  type ScheduledCartChargeRow,
} from "@/lib/scheduled-cart-charge";
import { processOneScheduledCartCharge } from "@/lib/process-scheduled-cart-charge";

export const dynamic = "force-dynamic";

function requestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    (proto && host ? `${proto}://${host}`.replace(/\/$/, "") : null) ||
    request.headers.get("origin")?.replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

/** POST — Staff retry a due or failed scheduled cart charge immediately. */
export async function POST(request: NextRequest) {
  const staffId = await getTrainerMemberId(request);
  if (!staffId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const member_id = String(body.member_id ?? "").trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureScheduledCartChargesTable(db);
  const row = getActiveScheduledChargeForMember(db, member_id);
  if (!row) {
    db.close();
    return NextResponse.json({ error: "No active scheduled charge" }, { status: 404 });
  }
  if (row.status === "awaiting_card") {
    db.close();
    return NextResponse.json({ error: "Still waiting for a saved card (finish Stripe setup first)." }, { status: 400 });
  }

  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);
  if (row.charge_on_ymd > today) {
    db.close();
    return NextResponse.json(
      { error: `Charge date is ${row.charge_on_ymd}. Retry is only for due or failed charges.` },
      { status: 400 }
    );
  }

  const stripe = new Stripe(stripeSecret);
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const retryRow = { ...row, last_attempt_ymd: null } as ScheduledCartChargeRow;
  db.prepare("UPDATE scheduled_cart_charges SET last_attempt_ymd = NULL WHERE id = ?").run(row.id);

  const result = await processOneScheduledCartCharge({
    db,
    row: retryRow,
    stripe,
    stripeSecret,
    todayYmd: today,
    confirmPaymentBaseUrl: requestOrigin(request),
    cronSecret,
    bypassRetryCadence: true,
  });
  db.close();

  if (result.status === "completed") {
    return NextResponse.json({ ok: true, payment_intent_id: result.payment_intent_id });
  }
  return NextResponse.json({ error: result.message }, { status: 400 });
}
