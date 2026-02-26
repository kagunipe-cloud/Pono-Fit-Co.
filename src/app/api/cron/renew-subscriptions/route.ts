import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersStripeColumn } from "../../../../lib/db";
import { grantAccess as kisiGrantAccess } from "../../../../lib/kisi";
import { ensureWaiverBeforeKisi } from "../../../../lib/waiver";
import { formatInAppTz, formatDateTimeInAppTz, todayInAppTz } from "../../../../lib/app-timezone";
import { randomUUID } from "crypto";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePriceToCents(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

function addDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() + n);
  else if (unit === "Week") d.setDate(d.getDate() + n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() + n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() + n);
  return d;
}

/** Today in gym timezone (e.g. "1/15/2026") to match expiry_date in DB. */
function todayString(tz: string): string {
  return formatInAppTz(new Date(), { month: "numeric", day: "numeric", year: "numeric" }, tz);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);

  const tz = getAppTimezone(db);
  const today = todayString(tz);
  // Only auto-renew monthly memberships (not yearly, daily, or other plan types)
  const expiring = db.prepare(`
    SELECT s.subscription_id, s.member_id, s.product_id, s.expiry_date, s.price as sub_price, s.quantity,
           p.plan_name, p.price as plan_price, p.length, p.unit
    FROM subscriptions s
    JOIN membership_plans p ON p.product_id = s.product_id
    WHERE s.status = 'Active' AND s.expiry_date = ? AND p.unit = 'Month'
  `).all(today) as {
    subscription_id: string;
    member_id: string;
    product_id: string;
    expiry_date: string;
    sub_price: string;
    quantity: number;
    plan_name: string;
    plan_price: string;
    length: string;
    unit: string;
  }[];

  const stripe = new Stripe(stripeSecret);
  const results: { member_id: string; status: "renewed" | "skipped" | "error"; message?: string }[] = [];

  for (const sub of expiring) {
    const memberRow = db.prepare("SELECT stripe_customer_id, email, first_name FROM members WHERE member_id = ?").get(sub.member_id) as { stripe_customer_id: string | null; email: string; first_name: string | null } | undefined;
    if (!memberRow?.stripe_customer_id) {
      results.push({ member_id: sub.member_id, status: "skipped", message: "No saved card" });
      continue;
    }

    const amountCents = parsePriceToCents(sub.plan_price) * Math.max(1, sub.quantity);
    if (amountCents <= 0) {
      results.push({ member_id: sub.member_id, status: "error", message: "Invalid price" });
      continue;
    }

    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: memberRow.stripe_customer_id,
        type: "card",
      });
      const pm = paymentMethods.data[0];
      if (!pm) {
        results.push({ member_id: sub.member_id, status: "error", message: "No payment method on file" });
        continue;
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: memberRow.stripe_customer_id,
        payment_method: pm.id,
        off_session: true,
        confirm: true,
        description: `Renewal: ${sub.plan_name}`,
        metadata: { member_id: sub.member_id, subscription_id: sub.subscription_id, type: "renewal" },
      });

      if (paymentIntent.status !== "succeeded") {
        results.push({ member_id: sub.member_id, status: "error", message: `Payment status: ${paymentIntent.status}` });
        continue;
      }

      const startDate = new Date();
      const expiryDate = addDuration(startDate, sub.length || "1", sub.unit || "Month");
      const startStr = formatInAppTz(startDate, { month: "numeric", day: "numeric", year: "numeric" }, tz);
      const expiryStr = formatInAppTz(expiryDate, { month: "numeric", day: "numeric", year: "numeric" }, tz);
      const daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const sales_id = randomUUID().slice(0, 8);
      const new_sub_id = randomUUID().slice(0, 8);

      db.exec("BEGIN TRANSACTION");
      try {
        db.prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run("Renewed", sub.subscription_id);
        db.prepare(`
          INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity)
          VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?)
        `).run(new_sub_id, sub.member_id, sub.product_id, startStr, expiryStr, String(daysRemaining), sub.plan_price, sales_id, sub.quantity);
        const date_time = formatDateTimeInAppTz(new Date(), undefined, tz);
        db.prepare(`
          INSERT INTO sales (sales_id, date_time, member_id, grand_total, email, status, sale_date)
          VALUES (?, ?, ?, ?, ?, 'Paid', ?)
        `).run(sales_id, date_time, sub.member_id, String(amountCents / 100), memberRow.email ?? "", todayInAppTz(tz));
        db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, sub.member_id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
      const waiver = await ensureWaiverBeforeKisi(sub.member_id, {
        email: memberRow.email ?? null,
        first_name: memberRow.first_name ?? null,
      }, origin);
      if (waiver.shouldGrantKisi) {
        const kisiId = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(sub.member_id) as { kisi_id: string | null } | undefined;
        if (kisiId?.kisi_id) {
          try {
            await kisiGrantAccess(kisiId.kisi_id, expiryDate);
          } catch (e) {
            console.error("[Kisi] renewal grant failed for member:", sub.member_id, e);
          }
        }
      }
      results.push({ member_id: sub.member_id, status: "renewed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ member_id: sub.member_id, status: "error", message: msg });
    }
  }

  db.close();

  const renewed = results.filter((r) => r.status === "renewed").length;
  const errors = results.filter((r) => r.status === "error");
  return NextResponse.json({
    date: today,
    expiring_count: expiring.length,
    renewed,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: errors.length,
    details: results,
  });
}
