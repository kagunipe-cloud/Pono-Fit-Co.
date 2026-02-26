import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

type CategoryRow = { category: string; count: number; revenue: number };

/** GET: Sales report by category (admin only). Query: from=YYYY-MM-DD&to=YYYY-MM-DD (optional). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from")?.trim() ?? "";
    const to = searchParams.get("to")?.trim() ?? "";
    const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
    const dateFilter = hasRange ? " AND s.sale_date >= ? AND s.sale_date <= ?" : "";
    const dateArgs = hasRange ? [from, to] : [];

    const byCategory: CategoryRow[] = [];

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(s.grand_total AS REAL)), 0) AS rev FROM sales s WHERE s.status != 'Refunded'${dateFilter}`
    ).get(...dateArgs) as { cnt: number; rev: number };
    const totalCount = Number(totalRow?.cnt ?? 0);
    const totalRevenue = Number(totalRow?.rev ?? 0);

    try {
      const sub = db.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(sub.price AS REAL)), 0) AS rev
         FROM subscriptions sub
         INNER JOIN sales s ON s.sales_id = sub.sales_id AND s.status != 'Refunded'${dateFilter}`
      ).get(...dateArgs) as { cnt: number; rev: number };
      byCategory.push({ category: "Membership", count: Number(sub?.cnt ?? 0), revenue: Number(sub?.rev ?? 0) });
    } catch {
      byCategory.push({ category: "Membership", count: 0, revenue: 0 });
    }

    try {
      const cls = db.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(b.price AS REAL)), 0) AS rev
         FROM class_bookings b
         INNER JOIN sales s ON s.sales_id = b.sales_id AND s.status != 'Refunded'${dateFilter}`
      ).get(...dateArgs) as { cnt: number; rev: number };
      byCategory.push({ category: "Class", count: Number(cls?.cnt ?? 0), revenue: Number(cls?.rev ?? 0) });
    } catch {
      byCategory.push({ category: "Class", count: 0, revenue: 0 });
    }

    try {
      const pt = db.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(b.price AS REAL)), 0) AS rev
         FROM pt_bookings b
         INNER JOIN sales s ON s.sales_id = b.sales_id AND s.status != 'Refunded'${dateFilter}`
      ).get(...dateArgs) as { cnt: number; rev: number };
      byCategory.push({ category: "PT", count: Number(pt?.cnt ?? 0), revenue: Number(pt?.rev ?? 0) });
    } catch {
      byCategory.push({ category: "PT", count: 0, revenue: 0 });
    }

    db.close();

    return NextResponse.json({
      totalCount,
      totalRevenue,
      byCategory,
      from: hasRange ? from : null,
      to: hasRange ? to : null,
    });
  } catch (err) {
    console.error("[admin/sales-report]", err);
    return NextResponse.json({ error: "Failed to load sales report" }, { status: 500 });
  }
}
