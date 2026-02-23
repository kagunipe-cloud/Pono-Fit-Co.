import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

/** GET: Sales list with member names (admin only). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT s.sales_id, s.date_time, s.member_id, s.grand_total, s.email, s.status,
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
