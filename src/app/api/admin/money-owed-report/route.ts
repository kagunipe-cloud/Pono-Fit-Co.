import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

export type MoneyOwedRow = {
  id: number;
  member_id: string;
  member_name: string;
  email: string | null;
  subscription_id: string | null;
  plan_name: string | null;
  amount_cents: number | null;
  amount_dollars: number;
  reason: string;
  stripe_error_code: string | null;
  attempted_at: string;
};

/** GET: Money owed report — recurring payments that failed or were skipped (admin only). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        f.id,
        f.member_id,
        f.subscription_id,
        f.plan_name,
        f.amount_cents,
        f.reason,
        f.stripe_error_code,
        f.attempted_at,
        m.first_name,
        m.last_name,
        m.email
      FROM payment_failures f
      LEFT JOIN members m ON m.member_id = f.member_id
      ORDER BY f.attempted_at DESC
    `).all() as (Record<string, unknown>)[];

    const list: MoneyOwedRow[] = rows.map((r) => {
      const first = String(r.first_name ?? "").trim();
      const last = String(r.last_name ?? "").trim();
      const memberName = [first, last].filter(Boolean).join(" ") || String(r.member_id);
      const amountCents = typeof r.amount_cents === "number" ? r.amount_cents : null;
      return {
        id: Number(r.id),
        member_id: String(r.member_id),
        member_name: memberName,
        email: r.email != null ? String(r.email) : null,
        subscription_id: r.subscription_id != null ? String(r.subscription_id) : null,
        plan_name: r.plan_name != null ? String(r.plan_name) : null,
        amount_cents: amountCents,
        amount_dollars: amountCents != null ? amountCents / 100 : 0,
        reason: String(r.reason ?? ""),
        stripe_error_code: r.stripe_error_code != null ? String(r.stripe_error_code) : null,
        attempted_at: String(r.attempted_at ?? ""),
      };
    });

    db.close();
    return NextResponse.json({ rows: list });
  } catch (err) {
    console.error("[admin/money-owed-report]", err);
    return NextResponse.json({ error: "Failed to load money owed report" }, { status: 500 });
  }
}
