import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { todayInAppTz } from "../../../../lib/app-timezone";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["Membership", "Class", "PT", "Other"] as const;

function getSalesIdsForCategory(db: ReturnType<typeof getDb>, category: string): Set<string> {
  const ids = new Set<string>();
  if (category === "Membership") {
    try {
      const rows = db.prepare("SELECT sales_id FROM subscriptions WHERE sales_id IS NOT NULL AND TRIM(sales_id) != ''").all() as { sales_id: string }[];
      rows.forEach((r) => ids.add(r.sales_id));
    } catch {
      /* subscriptions table may not exist */
    }
    const sales = db.prepare(
      "SELECT sales_id FROM sales WHERE sale_type = 'renewal' AND status != 'Refunded'"
    ).all() as { sales_id: string }[];
    for (const s of sales) {
      if (ids.has(s.sales_id)) continue;
      let hasSub = false;
      let hasClass = false;
      let hasPt = false;
      try {
        hasSub = (db.prepare("SELECT 1 FROM subscriptions WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      try {
        hasClass = (db.prepare("SELECT 1 FROM class_bookings WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      try {
        hasPt = (db.prepare("SELECT 1 FROM pt_bookings WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      if (!hasSub && !hasClass && !hasPt) ids.add(s.sales_id);
    }
  } else if (category === "Class") {
    try {
      const rows = db.prepare("SELECT sales_id FROM class_bookings WHERE sales_id IS NOT NULL AND TRIM(sales_id) != ''").all() as { sales_id: string }[];
      rows.forEach((r) => ids.add(r.sales_id));
    } catch {
      /* class_bookings may not exist */
    }
  } else if (category === "PT") {
    try {
      const rows = db.prepare("SELECT sales_id FROM pt_bookings WHERE sales_id IS NOT NULL AND TRIM(sales_id) != ''").all() as { sales_id: string }[];
      rows.forEach((r) => ids.add(r.sales_id));
    } catch {
      /* pt_bookings may not exist */
    }
  } else if (category === "Other") {
    const sales = db.prepare("SELECT sales_id FROM sales WHERE status != 'Refunded' AND (sale_type IS NULL OR sale_type != 'renewal')").all() as { sales_id: string }[];
    for (const s of sales) {
      let hasSub = false;
      let hasClass = false;
      let hasPt = false;
      try {
        hasSub = (db.prepare("SELECT 1 FROM subscriptions WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      try {
        hasClass = (db.prepare("SELECT 1 FROM class_bookings WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      try {
        hasPt = (db.prepare("SELECT 1 FROM pt_bookings WHERE sales_id = ?").get(s.sales_id) as unknown) != null;
      } catch {
        /* ignore */
      }
      if (!hasSub && !hasClass && !hasPt) ids.add(s.sales_id);
    }
  }
  return ids;
}

/** GET: Sales list with member names (admin only).
 *  Query: date=YYYY-MM-DD (single day), from=YYYY-MM-DD&to=YYYY-MM-DD (range), or date=all. category=Membership|Class|PT|Other (optional).
 *  Sorted newest first. */
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
    const fromParam = searchParams.get("from")?.trim();
    const toParam = searchParams.get("to")?.trim();
    const categoryParam = searchParams.get("category")?.trim();

    const showAll = dateParam === "all";
    const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(fromParam ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(toParam ?? "");
    const hasSingleDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "");
    const date = showAll ? null : hasSingleDate ? dateParam : !hasRange ? todayInAppTz(tz) : null;

    let rows: Record<string, unknown>[];
    if (date) {
      rows = db.prepare(
        `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.tax_amount, s.item_total, s.cc_fee, s.email, s.status,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM sales s
         LEFT JOIN members m ON m.member_id = s.member_id
         WHERE s.sale_date = ?
         ORDER BY s.date_time DESC`
      ).all(date) as Record<string, unknown>[];
    } else if (hasRange) {
      rows = db.prepare(
        `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.tax_amount, s.item_total, s.cc_fee, s.email, s.status,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM sales s
         LEFT JOIN members m ON m.member_id = s.member_id
         WHERE s.sale_date >= ? AND s.sale_date <= ?
         ORDER BY s.date_time DESC`
      ).all(fromParam, toParam) as Record<string, unknown>[];
    } else {
      rows = db.prepare(
        `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.tax_amount, s.item_total, s.cc_fee, s.email, s.status,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM sales s
         LEFT JOIN members m ON m.member_id = s.member_id
         ORDER BY s.date_time DESC`
      ).all() as Record<string, unknown>[];
    }

    if (categoryParam && VALID_CATEGORIES.includes(categoryParam as (typeof VALID_CATEGORIES)[number])) {
      const categoryIds = getSalesIdsForCategory(db, categoryParam);
      rows = rows.filter((r) => categoryIds.has(String(r.sales_id ?? "")));
    }

    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[admin/sales]", err);
    return NextResponse.json({ error: "Failed to load sales" }, { status: 500 });
  }
}
