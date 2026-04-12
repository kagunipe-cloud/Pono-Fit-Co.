import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { calendarDaysUntilExpiryYmd, normalizeDateToYMD, todayInAppTz } from "@/lib/app-timezone";
import { grantAccess as kisiGrantAccess } from "@/lib/kisi";

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

/**
 * POST — Admin: set a subscription’s period end (`expiry_date`) to a specific calendar day (gym timezone dates).
 * Updates `days_remaining`, and sets `members.exp_next_payment_date` to the latest active subscription expiry for this member.
 *
 * Body: `{ subscription_id: string, expiry_date: string }` — `expiry_date` is YYYY-MM-DD.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { subscription_id?: string; expiry_date?: string };
  try {
    body = (await request.json()) as { subscription_id?: string; expiry_date?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subscriptionId = String(body.subscription_id ?? "").trim();
  const rawExpiry = body.expiry_date;
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscription_id required" }, { status: 400 });
  }

  const expiryNorm = normalizeDateToYMD(typeof rawExpiry === "string" ? rawExpiry : null);
  if (!expiryNorm) {
    return NextResponse.json({ error: "expiry_date must be a valid date (YYYY-MM-DD)" }, { status: 400 });
  }

  const db = getDb();
  const tz = getAppTimezone(db);
  const todayYmd = todayInAppTz(tz);

  const row = db
    .prepare(
      `SELECT s.subscription_id, s.member_id, s.status, s.expiry_date
       FROM subscriptions s
       WHERE s.subscription_id = ?`
    )
    .get(subscriptionId) as
    | { subscription_id: string; member_id: string; status: string; expiry_date: string | null }
    | undefined;

  if (!row) {
    db.close();
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  if (row.status === "Cancelled") {
    db.close();
    return NextResponse.json({ error: "Cannot adjust a cancelled subscription" }, { status: 400 });
  }

  const daysCal = calendarDaysUntilExpiryYmd(expiryNorm, todayYmd);
  const daysRemainingStored = daysCal !== null ? String(Math.max(0, daysCal)) : "0";

  try {
    db.prepare("UPDATE subscriptions SET expiry_date = ?, days_remaining = ? WHERE subscription_id = ?").run(
      expiryNorm,
      daysRemainingStored,
      subscriptionId
    );

    const activeExpiries = db
      .prepare(
        `SELECT expiry_date FROM subscriptions WHERE member_id = ? AND status = 'Active' AND expiry_date IS NOT NULL AND TRIM(expiry_date) != ''`
      )
      .all(row.member_id) as { expiry_date: string }[];

    let maxExp: string | null = null;
    for (const r of activeExpiries) {
      const e = normalizeDateToYMD(r.expiry_date);
      if (!e) continue;
      if (!maxExp || e > maxExp) maxExp = e;
    }
    if (maxExp) {
      db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(maxExp, row.member_id);
    }

    const kisiRow = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(row.member_id) as
      | { kisi_id: string | null }
      | undefined;
    const kid = kisiRow?.kisi_id?.trim();
    db.close();

    let kisi_warning: string | undefined;
    if (kid) {
      const until = ymdToLocalNoon(expiryNorm);
      if (until) {
        try {
          await kisiGrantAccess(kid, until);
        } catch (e) {
          console.error("[adjust-expiry] Kisi grant failed", row.member_id, e);
          kisi_warning = "Saved in the app; Kisi door access could not be updated — adjust in Kisi if needed.";
        }
      }
    }

    return NextResponse.json({
      ok: true,
      subscription_id: subscriptionId,
      member_id: row.member_id,
      expiry_date: expiryNorm,
      days_remaining: daysRemainingStored,
      previous_expiry_date: row.expiry_date,
      ...(kisi_warning ? { kisi_warning } : {}),
    });
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[adjust-expiry]", e);
    const msg = e instanceof Error ? e.message : "Failed to update";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
