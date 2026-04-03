import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, ensureGiftPassesTable, ensureSubscriptionRenewalPromoColumns, ensureSubscriptionPassPackColumns, getAppTimezone } from "@/lib/db";
import { isPassPackPlan, passCreditsForPurchase } from "@/lib/pass-packs";
import { getMemberIdFromSession } from "@/lib/session";
import { formatDateForStorage } from "@/lib/app-timezone";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "@/lib/kisi";
import { ensureWaiverBeforeKisi } from "@/lib/waiver";

export const dynamic = "force-dynamic";

function addDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() + n);
  else if (unit === "Week") d.setDate(d.getDate() + n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() + n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() + n);
  return d;
}

/**
 * POST { token: string } — Logged-in member redeems a gift pass emailed to their account email.
 */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Log in to redeem your gift." }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tokenRaw = String(body.token ?? "").trim();
  if (!tokenRaw) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const db = getDb();
  ensureGiftPassesTable(db);
  ensureSubscriptionRenewalPromoColumns(db);

  const row = db
    .prepare("SELECT * FROM gift_passes WHERE token = ? AND status = 'pending'")
    .get(tokenRaw) as
    | {
        id: number;
        token: string;
        membership_plan_id: number;
        purchaser_member_id: string;
        recipient_email: string;
        status: string;
      }
    | undefined;

  if (!row) {
    db.close();
    return NextResponse.json({ error: "Invalid or already redeemed gift link." }, { status: 400 });
  }

  const member = db
    .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
    .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
  if (!member?.email?.trim()) {
    db.close();
    return NextResponse.json({ error: "Your account needs an email address to match this gift." }, { status: 400 });
  }

  if (member.email.trim().toLowerCase() !== row.recipient_email.trim().toLowerCase()) {
    db.close();
    return NextResponse.json(
      {
        error: "This gift was sent to a different email address. Log in with the email that received the gift.",
      },
      { status: 403 }
    );
  }

  const plan = db
    .prepare("SELECT * FROM membership_plans WHERE id = ?")
    .get(row.membership_plan_id) as
    | { plan_name: string; price: string; length: string; unit: string; product_id: string; category: string | null }
    | undefined;
  if (!plan) {
    db.close();
    return NextResponse.json({ error: "Membership plan no longer exists." }, { status: 400 });
  }

  const tz = getAppTimezone(db);
  const start_date = new Date();
  const startStr = formatDateForStorage(start_date, tz);
  const sub_id = randomUUID().slice(0, 8);
  const passPack = isPassPackPlan(plan);
  const giftPassCredits = passPack ? passCreditsForPurchase(plan, 1) : 0;
  let expiryStr = "";
  let expiryDateForKisi: Date | null = null;

  try {
    db.exec("BEGIN TRANSACTION");
    if (passPack) {
      ensureSubscriptionPassPackColumns(db);
      db.prepare(
        `INSERT INTO subscriptions (
           subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity,
           promo_renewals_remaining, renewal_price_indefinite, pass_credits_remaining, pass_activation_day
         )
         VALUES (?, ?, ?, 'Active', ?, '2000-01-01', '0', ?, NULL, 1, NULL, 0, ?, NULL)`
      ).run(sub_id, memberId, plan.product_id, startStr, plan.price ?? "0", giftPassCredits);
    } else {
      const expiry_date = addDuration(start_date, plan.length || "1", plan.unit || "Month");
      expiryStr = formatDateForStorage(expiry_date, tz);
      expiryDateForKisi = expiry_date;
      const daysRemaining = Math.ceil((expiry_date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      db.prepare(
        `INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity, promo_renewals_remaining, renewal_price_indefinite)
         VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, NULL, 1, NULL, 0)`
      ).run(sub_id, memberId, plan.product_id, startStr, expiryStr, String(daysRemaining), plan.price ?? "0");
      db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, memberId);
    }
    db.prepare(
      `UPDATE gift_passes SET status = 'redeemed', redeemed_member_id = ?, redeemed_at = datetime('now') WHERE id = ?`
    ).run(memberId, row.id);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    db.close();
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const waiver = await ensureWaiverBeforeKisi(
    memberId,
    { email: member.email ?? null, first_name: member.first_name ?? null },
    origin
  );
  if (!passPack && waiver.shouldGrantKisi && expiryDateForKisi) {
    let kisiId = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(memberId) as { kisi_id: string | null } | undefined;
    const email = member.email?.trim();
    if (email) {
      try {
        if (!kisiId?.kisi_id) {
          const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || undefined;
          const kid = await ensureKisiUser(email, name);
          db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kid, memberId);
          kisiId = { kisi_id: kid };
        }
        if (kisiId?.kisi_id) {
          await kisiGrantAccess(kisiId.kisi_id, expiryDateForKisi);
        }
      } catch (err) {
        console.error("[gift redeem] Kisi grant failed", err);
      }
    }
  }

  db.close();
  if (passPack) {
    return NextResponse.json({
      ok: true,
      plan_name: plan.plan_name,
      pass_pack: true,
      pass_credits_remaining: giftPassCredits,
      message: "Go to My Membership and tap Activate pass for today on the day you visit.",
    });
  }
  return NextResponse.json({ ok: true, plan_name: plan.plan_name, expiry_date: expiryStr });
}
