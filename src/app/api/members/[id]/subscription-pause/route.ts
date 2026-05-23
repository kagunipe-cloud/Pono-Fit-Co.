import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureSubscriptionPauseStartedColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  addDaysToDateStr,
  calendarDaysUntilExpiryYmd,
  normalizeDateToYMD,
  pausedCalendarDaysCreditedTowardExpiry,
  todayInAppTz,
} from "@/lib/app-timezone";
import { memberHasDoorAccessToday } from "@/lib/pass-access";
import { grantAccess as kisiGrantAccess, revokeAccess as kisiRevokeAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

function ymdToLocalNoon(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || mo < 0 || d < 1) return null;
  return new Date(y, mo, d, 12, 0, 0, 0);
}

function resolveRouteMember(db: ReturnType<typeof getDb>, routeParam: string): string | null {
  const isPurelyNumeric = /^\d+$/.test(routeParam);
  const row = (isPurelyNumeric
    ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(routeParam, 10), routeParam)
    : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(routeParam)) as { member_id: string } | undefined;
  return row?.member_id ?? null;
}

function loadSubscriptionsForAccess(db: ReturnType<typeof getDb>, memberId: string): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT s.status, s.expiry_date, s.pass_credits_remaining, s.pass_activation_day,
              s.subscription_pause_started
       FROM subscriptions s WHERE s.member_id = ?`
    )
    .all(memberId) as Record<string, unknown>[];
}

async function revokeKisiIfNoAccess(
  db: ReturnType<typeof getDb>,
  memberId: string,
  subscriptions: Record<string, unknown>[],
  todayYmd: string,
  passActivationDay: string
): Promise<void> {
  if (memberHasDoorAccessToday(subscriptions, todayYmd, passActivationDay)) return;
  const kidRow = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(memberId) as { kisi_id: string | null } | undefined;
  const kid = kidRow?.kisi_id?.trim();
  if (!kid) return;
  try {
    await kisiRevokeAccess(kid);
  } catch (e) {
    console.error("[subscription-pause] Kisi revoke failed", memberId, e);
  }
}

function syncMemberExpNextFromActiveExpiries(db: ReturnType<typeof getDb>, memberId: string): void {
  const activeExpiries = db
    .prepare(
      `SELECT expiry_date FROM subscriptions WHERE member_id = ? AND status = 'Active'
       AND expiry_date IS NOT NULL AND TRIM(expiry_date) != ''`
    )
    .all(memberId) as { expiry_date: string }[];
  let maxExp: string | null = null;
  for (const r of activeExpiries) {
    const e = normalizeDateToYMD(r.expiry_date);
    if (!e) continue;
    if (!maxExp || e > maxExp) maxExp = e;
  }
  if (maxExp) {
    db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(maxExp, memberId);
  }
}

/**
 * POST — Admin only. Freeze or restart calendar-membership benefits for one Active subscription row.
 *
 * Body: `{ subscription_id: string, paused: boolean }`.
 * Pause sets `subscription_pause_started` (today gym TZ): no door from this row; renew cron skips Stripe.
 * Resume clears pause and bumps `expiry_date` by full calendar freeze days through the day before resume.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const routeId = ((await params).id ?? "").trim();
  if (!routeId || routeId.length < 2) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

  let body: { subscription_id?: unknown; paused?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const subscriptionId = String(body.subscription_id ?? "").trim();
  if (!subscriptionId) return NextResponse.json({ error: "subscription_id required" }, { status: 400 });
  if (typeof body.paused !== "boolean") return NextResponse.json({ error: "paused boolean required" }, { status: 400 });
  const wantsPause = body.paused === true;

  const db = getDb();
  ensureSubscriptionPauseStartedColumn(db);
  const tz = getAppTimezone(db);
  const todayYmd = todayInAppTz(tz);

  const memberIdResolved = resolveRouteMember(db, routeId);
  if (!memberIdResolved) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const sub = db
    .prepare(
      `SELECT s.subscription_id, s.member_id, s.status, s.expiry_date,
              s.pass_credits_remaining, s.subscription_pause_started,
              COALESCE(p.unit, '') AS plan_unit, COALESCE(p.category, '') AS plan_category
       FROM subscriptions s
       LEFT JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.subscription_id = ?`
    )
    .get(subscriptionId) as
    | {
        subscription_id: string;
        member_id: string;
        status: string;
        expiry_date: string | null;
        pass_credits_remaining: number | null | string;
        subscription_pause_started: string | null;
        plan_unit: string;
        plan_category: string;
      }
    | undefined;

  if (!sub || String(sub.member_id).trim() !== memberIdResolved.trim()) {
    db.close();
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  if (sub.status !== "Active") {
    db.close();
    return NextResponse.json({ error: "Only Active subscriptions can be paused or resumed." }, { status: 400 });
  }

  const pc = sub.pass_credits_remaining;
  if (pc != null && String(pc).trim() !== "") {
    db.close();
    return NextResponse.json({ error: "Pass-pack memberships use activate-a-day instead of freeze." }, { status: 400 });
  }
  const cat = String(sub.plan_category ?? "").trim().toLowerCase();
  const unit = String(sub.plan_unit ?? "").trim().toLowerCase();
  if (cat === "passes" && unit === "day") {
    db.close();
    return NextResponse.json({ error: "Day pass memberships cannot use this freeze." }, { status: 400 });
  }

  const passDay = db.prepare("SELECT pass_activation_day FROM members WHERE member_id = ?").get(memberIdResolved) as
    | { pass_activation_day: string | null }
    | undefined;
  const memberPassDay = String(passDay?.pass_activation_day ?? "").trim();

  const pauseStartStored = String(sub.subscription_pause_started ?? "").trim();

  try {
    if (wantsPause) {
      if (pauseStartStored !== "") {
        db.close();
        return NextResponse.json({ error: "Membership is already paused." }, { status: 400 });
      }
      db.prepare("UPDATE subscriptions SET subscription_pause_started = ? WHERE subscription_id = ?").run(todayYmd, subscriptionId);
      const subsAfter = loadSubscriptionsForAccess(db, memberIdResolved);
      await revokeKisiIfNoAccess(db, memberIdResolved, subsAfter, todayYmd, memberPassDay);
      db.close();
      return NextResponse.json({
        ok: true,
        paused: true,
        subscription_id: subscriptionId,
        pause_started: todayYmd,
      });
    }

    if (pauseStartStored === "") {
      db.close();
      return NextResponse.json({ error: "Membership is not paused." }, { status: 400 });
    }

    const expNorm = normalizeDateToYMD(sub.expiry_date);
    if (!expNorm) {
      db.close();
      return NextResponse.json({ error: "Subscription has no valid expiry_date to extend." }, { status: 400 });
    }

    const extendBy = pausedCalendarDaysCreditedTowardExpiry(pauseStartStored, todayYmd);
    const newExpiryNorm = extendBy <= 0 ? expNorm : addDaysToDateStr(expNorm, extendBy);
    const daysCal = calendarDaysUntilExpiryYmd(newExpiryNorm, todayYmd);
    const daysRemainingStored = daysCal !== null ? String(Math.max(0, daysCal)) : "0";

    db.prepare(
      `UPDATE subscriptions SET subscription_pause_started = NULL, expiry_date = ?, days_remaining = ? WHERE subscription_id = ?`
    ).run(newExpiryNorm, daysRemainingStored, subscriptionId);

    syncMemberExpNextFromActiveExpiries(db, memberIdResolved);

    const kisiRow = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(memberIdResolved) as
      | { kisi_id: string | null }
      | undefined;
    const kid = kisiRow?.kisi_id?.trim();
    let kisi_warning: string | undefined;
    if (kid && newExpiryNorm >= todayYmd) {
      const until = ymdToLocalNoon(newExpiryNorm);
      if (until) {
        try {
          await kisiGrantAccess(kid, until);
        } catch (e) {
          console.error("[subscription-pause] Kisi grant failed", memberIdResolved, e);
          kisi_warning = "Dates updated locally; door access sync may still need checking in Kisi.";
        }
      }
    }

    db.close();

    return NextResponse.json({
      ok: true,
      paused: false,
      subscription_id: subscriptionId,
      extended_by_calendar_days: extendBy,
      previous_expiry_date: expNorm,
      new_expiry_date: newExpiryNorm,
      days_remaining: daysRemainingStored,
      ...(kisi_warning ? { kisi_warning } : {}),
    });
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[subscription-pause]", e);
    return NextResponse.json({ error: "Failed to update membership pause" }, { status: 500 });
  }
}
