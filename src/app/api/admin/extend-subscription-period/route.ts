import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, expiryDateSortableSql } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { formatDateForStorage } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

/** Same period math as renewal-extension (extend from current period end, not “today”). */
function parseStoredYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || mo < 0 || d < 1) return null;
  return new Date(y, mo, d, 12, 0, 0, 0);
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

function subtractDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() - n);
  else if (unit === "Week") d.setDate(d.getDate() - n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() - n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() - n);
  return d;
}

/**
 * POST — Admin: shift Active **monthly** subscription end by N billing periods (default 1).
 * Updates `subscriptions.expiry_date`, `days_remaining`, and `members.exp_next_payment_date`.
 *
 * - **Forward** (default): add periods from current expiry — e.g. skip a renewal charge window.
 * - **Backward** (`subtract: true`): remove periods from current expiry — e.g. realign after a missed
 *   external charge so `expiry_date` is sooner and `/api/cron/renew-subscriptions` can retry Stripe.
 *
 * Body: `{ member_ids: string[], periods?: number, subtract?: boolean }`
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { member_ids?: unknown; periods?: unknown; subtract?: unknown };
  try {
    body = (await request.json()) as { member_ids?: unknown; periods?: unknown; subtract?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds = body.member_ids;
  const memberIds = Array.isArray(rawIds)
    ? rawIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "member_ids (non-empty array) is required" }, { status: 400 });
  }

  const periods = Math.max(1, Math.min(24, parseInt(String(body.periods ?? "1"), 10) || 1));
  const subtract = body.subtract === true;

  const db = getDb();
  const tz = getAppTimezone(db);

  const updated: {
    member_id: string;
    subscription_id: string;
    old_expiry_date: string;
    new_expiry_date: string;
  }[] = [];
  const skipped: { member_id: string; reason: string }[] = [];

  for (const memberId of memberIds) {
    const sub = db
      .prepare(
        `SELECT s.subscription_id, s.expiry_date, p.length as plan_length, p.unit
         FROM subscriptions s
         JOIN membership_plans p ON p.product_id = s.product_id
         WHERE s.member_id = ? AND s.status = 'Active' AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'
         ORDER BY ${expiryDateSortableSql("s.expiry_date")} DESC
         LIMIT 1`
      )
      .get(memberId) as
      | {
          subscription_id: string;
          expiry_date: string;
          plan_length: string | null;
          unit: string | null;
        }
      | undefined;

    if (!sub?.expiry_date?.trim()) {
      skipped.push({ member_id: memberId, reason: "No active monthly subscription found" });
      continue;
    }

    const anchor = parseStoredYmdToLocalDate(sub.expiry_date.trim());
    if (!anchor) {
      skipped.push({ member_id: memberId, reason: "Invalid expiry_date on subscription" });
      continue;
    }

    const length = (sub.plan_length ?? "1").trim() || "1";
    const unit = (sub.unit ?? "Month").trim() || "Month";

    let end = anchor;
    for (let i = 0; i < periods; i++) {
      end = subtract ? subtractDuration(end, length, unit) : addDuration(end, length, unit);
    }

    const expiryStr = formatDateForStorage(end, tz);
    const daysRemaining = Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

    try {
      db.prepare("UPDATE subscriptions SET expiry_date = ?, days_remaining = ? WHERE subscription_id = ?").run(
        expiryStr,
        String(Math.max(0, daysRemaining)),
        sub.subscription_id
      );
      db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, memberId);
      updated.push({
        member_id: memberId,
        subscription_id: sub.subscription_id,
        old_expiry_date: sub.expiry_date.trim(),
        new_expiry_date: expiryStr,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push({ member_id: memberId, reason: msg });
    }
  }

  db.close();

  return NextResponse.json({
    ok: true,
    timezone: tz,
    periods,
    subtract,
    updated,
    skipped: skipped.length ? skipped : undefined,
  });
}
