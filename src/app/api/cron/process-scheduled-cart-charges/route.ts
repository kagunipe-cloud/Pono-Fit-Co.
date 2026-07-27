import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, getAppTimezone } from "@/lib/db";
import { todayInAppTz } from "@/lib/app-timezone";
import { ensureScheduledCartChargesTable, type ScheduledCartChargeRow } from "@/lib/scheduled-cart-charge";
import { processOneScheduledCartCharge } from "@/lib/process-scheduled-cart-charge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const db = getDb();
  ensureScheduledCartChargesTable(db);
  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);

  const due = db
    .prepare(
      `SELECT * FROM scheduled_cart_charges
       WHERE status IN ('pending', 'failed') AND charge_on_ymd <= ?
       ORDER BY charge_on_ymd ASC, id ASC`
    )
    .all(today) as ScheduledCartChargeRow[];

  const stripe = new Stripe(stripeSecret);
  const cronSecret = secret?.trim() ?? "";
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  const confirmPaymentBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    (proto && host ? `${proto}://${host}`.replace(/\/$/, "") : request.nextUrl.origin);

  const results: { id: number; member_id: string; status: string; message?: string }[] = [];
  for (const row of due) {
    const result = await processOneScheduledCartCharge({
      db,
      row,
      stripe,
      stripeSecret,
      todayYmd: today,
      confirmPaymentBaseUrl,
      cronSecret,
    });
    results.push({
      id: row.id,
      member_id: row.member_id,
      status: result.status,
      message: "message" in result ? result.message : undefined,
    });
  }

  db.close();

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return NextResponse.json({
    date: today,
    due_count: due.length,
    completed,
    failed,
    skipped: results.filter((r) => r.status === "skipped").length,
    details: results,
  });
}
