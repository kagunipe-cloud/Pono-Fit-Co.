import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { todayInAppTz } from "../../../../lib/app-timezone";

export const dynamic = "force-dynamic";

/** GET: Sales list with member names (admin only). Query: date=YYYY-MM-DD (default today) or date=all. Sorted newest first. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date")?.trim();
    const showAll = dateParam === "all";
    const date = showAll ? null : (/^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam : todayInAppTz(tz));

    const rows = date
      ? db.prepare(
          `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.tax_amount, s.item_total, s.cc_fee, s.email, s.status,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM sales s
           LEFT JOIN members m ON m.member_id = s.member_id
           WHERE s.sale_date = ?
           ORDER BY s.date_time DESC`
        ).all(date) as Record<string, unknown>[]
      : db.prepare(
          `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.tax_amount, s.item_total, s.cc_fee, s.email, s.status,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM sales s
           LEFT JOIN members m ON m.member_id = s.member_id
           ORDER BY s.date_time DESC`
        ).all() as Record<string, unknown>[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[admin/sales]", err);
    return NextResponse.json({ error: "Failed to load sales" }, { status: 500 });
  }
}
