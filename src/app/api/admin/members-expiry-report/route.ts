import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersAutoRenewColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { addDaysToDateStr, todayInAppTz, weekStartInAppTz } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

export type MembersExpiryRow = {
  member_id: string;
  email: string | null;
  member_name: string;
  subscription_id: string | null;
  plan_name: string | null;
  status: string | null;
  expiry_date: string | null;
  auto_renew: number;
  price: string | null;
};

export type MembersExpiryRange =
  | "expiring_today"
  | "expiring_tomorrow"
  | "expiring_rest_of_week"
  | "expired_yesterday"
  | "expired_last_two_days"
  | "expired_last_week"
  | "calendar_month";

/**
 * GET ?range=...&month=YYYY-MM (required when range=calendar_month)
 * Active memberships (non–pass-pack) with subscription expiry in the selected window.
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = (request.nextUrl.searchParams.get("range") ?? "expiring_today").trim() as MembersExpiryRange;
  const monthParam = (request.nextUrl.searchParams.get("month") ?? "").trim();

  const validRanges: MembersExpiryRange[] = [
    "expiring_today",
    "expiring_tomorrow",
    "expiring_rest_of_week",
    "expired_yesterday",
    "expired_last_two_days",
    "expired_last_week",
    "calendar_month",
  ];
  if (!validRanges.includes(range)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  if (range === "calendar_month") {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: "month=YYYY-MM required for calendar_month" }, { status: 400 });
    }
  }

  try {
    const db = getDb();
    ensureMembersAutoRenewColumn(db);
    const tz = getAppTimezone(db);
    const today = todayInAppTz(tz);
    const tomorrow = addDaysToDateStr(today, 1);
    const yesterday = addDaysToDateStr(today, -1);
    const twoDaysAgo = addDaysToDateStr(today, -2);
    const threeDaysAgo = addDaysToDateStr(today, -3);
    const sevenDaysAgo = addDaysToDateStr(today, -7);

    const monday = weekStartInAppTz(today);
    const sundayThisWeek = addDaysToDateStr(monday, 6);

    let expiryMin: string;
    let expiryMax: string;
    let activeOnly: boolean;

    switch (range) {
      case "expiring_today":
        expiryMin = today;
        expiryMax = today;
        activeOnly = true;
        break;
      case "expiring_tomorrow":
        expiryMin = tomorrow;
        expiryMax = tomorrow;
        activeOnly = true;
        break;
      case "expiring_rest_of_week": {
        const start = addDaysToDateStr(today, 2);
        if (start > sundayThisWeek) {
          expiryMin = "9999-12-31";
          expiryMax = "9999-12-30";
        } else {
          expiryMin = start;
          expiryMax = sundayThisWeek;
        }
        activeOnly = true;
        break;
      }
      case "expired_yesterday":
        expiryMin = yesterday;
        expiryMax = yesterday;
        activeOnly = false;
        break;
      case "expired_last_two_days":
        expiryMin = twoDaysAgo;
        expiryMax = yesterday;
        activeOnly = false;
        break;
      case "expired_last_week":
        expiryMin = sevenDaysAgo;
        expiryMax = threeDaysAgo;
        activeOnly = false;
        break;
      case "calendar_month": {
        const [y, mo] = monthParam.split("-").map(Number);
        const lastDay = new Date(y, mo, 0).getDate();
        expiryMin = `${monthParam}-01`;
        expiryMax = `${y}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        activeOnly = false;
        break;
      }
      default:
        expiryMin = today;
        expiryMax = today;
        activeOnly = true;
    }

    const passPackExclusion = `(s.pass_credits_remaining IS NULL)`;

    let statusClause: string;
    if (activeOnly) {
      statusClause = `s.status = 'Active'`;
    } else {
      statusClause = `(s.status = 'Active' OR s.status = 'Cancelled')`;
    }

    const sql = `
      SELECT s.subscription_id, s.member_id, s.status, s.expiry_date, s.price,
             m.email, m.first_name, m.last_name, COALESCE(m.auto_renew, 0) AS auto_renew,
             p.plan_name
      FROM subscriptions s
      JOIN members m ON m.member_id = s.member_id
      LEFT JOIN membership_plans p ON p.product_id = s.product_id
      WHERE ${passPackExclusion}
        AND ${statusClause}
        AND s.expiry_date IS NOT NULL
        AND TRIM(s.expiry_date) != ''
        AND s.expiry_date >= ?
        AND s.expiry_date <= ?
      ORDER BY s.expiry_date ASC, m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE
    `;

    const rows = db.prepare(sql).all(expiryMin, expiryMax) as {
      subscription_id: string | null;
      member_id: string;
      status: string | null;
      expiry_date: string | null;
      price: string | null;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      auto_renew: number;
      plan_name: string | null;
    }[];

    db.close();

    const list: MembersExpiryRow[] = rows.map((r) => ({
      member_id: r.member_id,
      email: r.email,
      member_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
      subscription_id: r.subscription_id,
      plan_name: r.plan_name,
      status: r.status,
      expiry_date: r.expiry_date,
      auto_renew: Number(r.auto_renew) === 1 ? 1 : 0,
      price: r.price,
    }));

    return NextResponse.json({
      range,
      month: range === "calendar_month" ? monthParam : null,
      todayYmd: today,
      timezone: tz,
      expiryWindow: { start: expiryMin, end: expiryMax },
      rows: list,
    });
  } catch (err) {
    console.error("[members-expiry-report]", err);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}
