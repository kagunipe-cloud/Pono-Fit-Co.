import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureSubscriptionPassPackColumns, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { todayInAppTz } from "@/lib/app-timezone";
import { isPassPackPlan } from "@/lib/pass-packs";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "@/lib/kisi";
import { ensureWaiverBeforeKisi } from "@/lib/waiver";
import { endOfCalendarDayInTimeZone } from "@/lib/pass-access";

export const dynamic = "force-dynamic";

/** POST { subscription_id: string } — Use one banked day pass for today (app timezone). */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Log in to activate a pass." }, { status: 401 });
  }

  let body: { subscription_id?: string };
  try {
    body = (await request.json()) as { subscription_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subId = String(body.subscription_id ?? "").trim();
  if (!subId) {
    return NextResponse.json({ error: "subscription_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureSubscriptionPassPackColumns(db);
  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);

  const row = db
    .prepare(
      `SELECT s.subscription_id, s.member_id, s.pass_credits_remaining, s.pass_activation_day, s.product_id,
              p.plan_name, p.category, p.unit
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.subscription_id = ? AND s.member_id = ? AND s.status = 'Active'`
    )
    .get(subId, memberId) as
    | {
        subscription_id: string;
        member_id: string;
        pass_credits_remaining: number | null;
        pass_activation_day: string | null;
        product_id: string;
        plan_name: string | null;
        category: string | null;
        unit: string | null;
      }
    | undefined;

  if (!row || row.pass_credits_remaining == null) {
    db.close();
    return NextResponse.json({ error: "Not a day pass subscription." }, { status: 404 });
  }

  if (!isPassPackPlan({ category: row.category, unit: row.unit })) {
    db.close();
    return NextResponse.json({ error: "Not a day pass subscription." }, { status: 400 });
  }

  const credits = row.pass_credits_remaining;
  if (credits <= 0) {
    db.close();
    return NextResponse.json({ error: "No pass days left on this pack." }, { status: 400 });
  }

  const activationDay = (row.pass_activation_day ?? "").trim();
  if (activationDay === today) {
    db.close();
    return NextResponse.json({ error: "You already activated a pass for today." }, { status: 400 });
  }

  const member = db
    .prepare("SELECT email, first_name, last_name, kisi_id FROM members WHERE member_id = ?")
    .get(memberId) as { email: string | null; first_name: string | null; last_name: string | null; kisi_id: string | null } | undefined;

  db.prepare(
    `UPDATE subscriptions
     SET pass_credits_remaining = pass_credits_remaining - 1,
         pass_activation_day = ?,
         expiry_date = ?
     WHERE subscription_id = ? AND member_id = ?`
  ).run(today, today, subId, memberId);

  db.close();

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const waiver = await ensureWaiverBeforeKisi(
    memberId,
    { email: member?.email ?? null, first_name: member?.first_name ?? null },
    origin
  );

  const validUntil = endOfCalendarDayInTimeZone(today, tz);

  if (waiver.shouldGrantKisi && member?.email?.trim()) {
    try {
      let kisiId = member.kisi_id?.trim() || null;
      if (!kisiId) {
        const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || undefined;
        kisiId = await ensureKisiUser(member.email.trim(), name);
        const db2 = getDb();
        db2.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, memberId);
        db2.close();
      }
      if (kisiId) {
        await kisiGrantAccess(kisiId, validUntil);
      }
    } catch (e) {
      console.error("[activate-pass-day] Kisi grant failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    pass_credits_remaining: credits - 1,
    pass_activation_day: today,
    valid_until: validUntil.toISOString(),
    plan_name: row.plan_name ?? "Pass pack",
  });
}
