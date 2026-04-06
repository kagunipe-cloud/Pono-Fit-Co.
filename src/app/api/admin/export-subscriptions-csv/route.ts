import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  ensureMembersAutoRenewColumn,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
} from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";

export const dynamic = "force-dynamic";

function csvEscape(v: string | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type Row = {
  subscription_id: string | null;
  member_id: string;
  product_id: string | null;
  status: string | null;
  start_date: string | null;
  expiry_date: string | null;
  days_remaining: string | null;
  price: string | null;
  email: string | null;
  stripe_customer_id: string | null;
  auto_renew: number | null;
  plan_name: string | null;
  complimentary: number | null;
  complimentary_renewals_remaining: number | null;
  renewal_discount_percent: number | null;
};

/**
 * GET — CSV of subscriptions with member email and Stripe customer id (admin only).
 * Query: ?status=all|active|cancelled&q= (optional search, same spirit as subscriptions report)
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusParam = request.nextUrl.searchParams.get("status")?.trim().toLowerCase() || "all";
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  const statusFilter = statusParam === "all" ? null : statusParam === "active" ? "Active" : statusParam === "cancelled" ? "Cancelled" : null;

  try {
    const db = getDb();
    ensureMembersAutoRenewColumn(db);
    ensureSubscriptionComplimentaryColumns(db);
    ensureSubscriptionRenewalDiscountPercentColumn(db);

    let sql = `
      SELECT s.subscription_id, s.member_id, s.product_id, s.status, s.start_date, s.expiry_date, s.days_remaining, s.price,
             s.complimentary, s.complimentary_renewals_remaining, s.renewal_discount_percent,
             m.email, m.stripe_customer_id, m.auto_renew, p.plan_name
      FROM subscriptions s
      LEFT JOIN members m ON m.member_id = s.member_id
      LEFT JOIN membership_plans p ON p.product_id = s.product_id
    `;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (statusFilter) {
      conditions.push("s.status = ?");
      params.push(statusFilter);
    }

    if (q) {
      conditions.push(
        "(m.email LIKE ? OR m.first_name LIKE ? OR m.last_name LIKE ? OR (COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')) LIKE ? OR p.plan_name LIKE ?)"
      );
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY s.status ASC, s.expiry_date DESC, s.id ASC";

    const rows = db.prepare(sql).all(...params) as Row[];
    db.close();

    const header = [
      "email",
      "member_id",
      "stripe_customer_id",
      "auto_renew",
      "subscription_id",
      "product_id",
      "plan_name",
      "status",
      "start_date",
      "expiry_date",
      "days_remaining",
      "price",
      "complimentary",
      "complimentary_renewals_remaining",
      "discount_percent",
    ];

    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          csvEscape(r.email),
          csvEscape(r.member_id),
          csvEscape(r.stripe_customer_id),
          r.auto_renew === 1 ? "1" : "0",
          csvEscape(r.subscription_id),
          csvEscape(r.product_id),
          csvEscape(r.plan_name),
          csvEscape(r.status),
          csvEscape(r.start_date),
          csvEscape(r.expiry_date),
          csvEscape(r.days_remaining),
          csvEscape(r.price),
          r.complimentary === 1 ? "1" : "0",
          r.complimentary_renewals_remaining != null ? String(r.complimentary_renewals_remaining) : "",
          r.renewal_discount_percent != null ? String(r.renewal_discount_percent) : "",
        ].join(",")
      ),
    ];

    const body = lines.join("\r\n") + "\r\n";
    const dateStr = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="subscriptions-export-${dateStr}.csv"`,
      },
    });
  } catch (err) {
    console.error("[export-subscriptions-csv]", err);
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
