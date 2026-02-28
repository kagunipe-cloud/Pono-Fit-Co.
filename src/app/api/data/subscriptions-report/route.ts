import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type SubRow = {
  id: number;
  subscription_id: string;
  member_id: string;
  product_id: string;
  status: string;
  start_date: string | null;
  expiry_date: string | null;
  days_remaining: string | null;
  price: string | null;
  first_name: string | null;
  last_name: string | null;
  plan_name: string | null;
};

/**
 * GET ?status=all|Active|Cancelled&q=
 * Returns subscriptions with member_name and plan_name for the report.
 */
export async function GET(request: NextRequest) {
  try {
    const statusParam = request.nextUrl.searchParams.get("status")?.trim().toLowerCase() || "all";
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";

    const statusFilter = statusParam === "all" ? null : statusParam === "active" ? "Active" : statusParam === "cancelled" ? "Cancelled" : null;

    const db = getDb();

    let sql = `
      SELECT s.id, s.subscription_id, s.member_id, s.product_id, s.status, s.start_date, s.expiry_date, s.days_remaining, s.price,
        m.first_name, m.last_name, p.plan_name
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
      conditions.push("(m.first_name LIKE ? OR m.last_name LIKE ? OR (COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')) LIKE ? OR (COALESCE(m.last_name,'') || ' ' || COALESCE(m.first_name,'')) LIKE ? OR p.plan_name LIKE ?)");
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY s.status ASC, s.expiry_date DESC, s.id ASC";

    const rows = db.prepare(sql).all(...params) as SubRow[];
    db.close();

    const result = rows.map((r) => ({
      id: r.id,
      subscription_id: r.subscription_id,
      member_id: r.member_id,
      product_id: r.product_id,
      member_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
      plan_name: r.plan_name ?? "—",
      status: r.status ?? "—",
      start_date: r.start_date ?? "—",
      expiry_date: r.expiry_date ?? "—",
      days_remaining: r.days_remaining ?? "—",
      price: r.price ?? "—",
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}
