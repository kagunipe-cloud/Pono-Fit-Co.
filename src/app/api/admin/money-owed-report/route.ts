import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

export type MoneyOwedAttemptRow = {
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
  dismissed_at?: string | null;
};

/** One logical debt: member + subscription, with retries collapsed for “owed” amount. */
export type MoneyOwedAggregatedRow = {
  member_id: string;
  member_name: string;
  email: string | null;
  subscription_id: string | null;
  plan_name: string | null;
  /** Single-period amount (from latest attempt in the group). */
  amount_cents: number | null;
  amount_dollars: number;
  attempt_count: number;
  /** Sum of all attempt amounts (e.g. 3 × period price if retried 3 times). */
  sum_amount_cents: number;
  sum_amount_dollars: number;
  latest_reason: string;
  latest_stripe_error_code: string | null;
  first_attempted_at: string;
  last_attempted_at: string;
  failure_ids: number[];
};

function mapAttemptRow(r: Record<string, unknown>): MoneyOwedAttemptRow {
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
    dismissed_at: r.dismissed_at != null && String(r.dismissed_at).trim() !== "" ? String(r.dismissed_at) : null,
  };
}

/** GET: Money owed + failed payment attempts (admin only).
 *  - `attempts`: every cron/API failure row (for “Failed transactions” in Transactions).
 *  - `aggregated`: one row per member + subscription — amount = one period; retries counted.
 *  Query: `?view=archived` — archived (cancel subscription) rows only.
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const archived = request.nextUrl.searchParams.get("view")?.trim().toLowerCase() === "archived";

  try {
    const db = getDb();
    const whereDismissed = archived
      ? `WHERE f.dismissed_at IS NOT NULL AND TRIM(f.dismissed_at) != ''`
      : `WHERE f.dismissed_at IS NULL OR TRIM(COALESCE(f.dismissed_at, '')) = ''`;
    const whereDismissedBare = archived
      ? `WHERE dismissed_at IS NOT NULL AND TRIM(dismissed_at) != ''`
      : `WHERE dismissed_at IS NULL OR TRIM(COALESCE(dismissed_at, '')) = ''`;
    const orderAttempts = archived ? `ORDER BY f.dismissed_at DESC` : `ORDER BY f.attempted_at DESC`;

    const rawAttempts = db.prepare(`
      SELECT
        f.id,
        f.member_id,
        f.subscription_id,
        f.plan_name,
        f.amount_cents,
        f.reason,
        f.stripe_error_code,
        f.attempted_at,
        f.dismissed_at,
        m.first_name,
        m.last_name,
        m.email
      FROM payment_failures f
      LEFT JOIN members m ON m.member_id = f.member_id
      ${whereDismissed}
      ${orderAttempts}
    `).all() as Record<string, unknown>[];

    const attempts: MoneyOwedAttemptRow[] = rawAttempts.map(mapAttemptRow);

    const groupRows = db.prepare(`
      SELECT
        f.member_id,
        f.subscription_id,
        COUNT(*) AS attempt_count,
        COALESCE(SUM(f.amount_cents), 0) AS sum_amount_cents,
        MIN(f.attempted_at) AS first_attempted_at,
        MAX(f.attempted_at) AS last_attempted_at,
        GROUP_CONCAT(f.id) AS id_list,
        m.first_name,
        m.last_name,
        m.email
      FROM payment_failures f
      LEFT JOIN members m ON m.member_id = f.member_id
      ${whereDismissed}
      GROUP BY f.member_id, COALESCE(f.subscription_id, '')
      ORDER BY
        COALESCE(NULLIF(TRIM(m.last_name), ''), 'zzz') COLLATE NOCASE ASC,
        COALESCE(NULLIF(TRIM(m.first_name), ''), '') COLLATE NOCASE ASC,
        last_attempted_at DESC
    `).all() as {
      member_id: string;
      subscription_id: string | null;
      attempt_count: number;
      sum_amount_cents: number;
      first_attempted_at: string;
      last_attempted_at: string;
      id_list: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }[];

    const latestStmt = db.prepare(`
      SELECT plan_name, amount_cents, reason, stripe_error_code
      FROM payment_failures
      ${whereDismissedBare}
        AND member_id = ?
        AND COALESCE(subscription_id, '') = ?
      ORDER BY datetime(attempted_at) DESC
      LIMIT 1
    `);

    const aggregated: MoneyOwedAggregatedRow[] = [];
    for (const g of groupRows) {
      const subKey = g.subscription_id != null ? String(g.subscription_id) : "";
      const latest = latestStmt.get(g.member_id, subKey) as
        | { plan_name: string | null; amount_cents: number | null; reason: string; stripe_error_code: string | null }
        | undefined;

      const first = String(g.first_name ?? "").trim();
      const last = String(g.last_name ?? "").trim();
      const memberName = [first, last].filter(Boolean).join(" ") || String(g.member_id);
      const ids = String(g.id_list ?? "")
        .split(",")
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => Number.isFinite(n));
      const amountCents = latest?.amount_cents ?? null;
      const sumCents = typeof g.sum_amount_cents === "number" ? g.sum_amount_cents : 0;

      aggregated.push({
        member_id: String(g.member_id),
        member_name: memberName,
        email: g.email != null ? String(g.email) : null,
        subscription_id: g.subscription_id != null ? String(g.subscription_id) : null,
        plan_name: latest?.plan_name != null ? String(latest.plan_name) : null,
        amount_cents: amountCents,
        amount_dollars: amountCents != null ? amountCents / 100 : 0,
        attempt_count: g.attempt_count,
        sum_amount_cents: sumCents,
        sum_amount_dollars: sumCents / 100,
        latest_reason: String(latest?.reason ?? ""),
        latest_stripe_error_code: latest?.stripe_error_code != null ? String(latest.stripe_error_code) : null,
        first_attempted_at: String(g.first_attempted_at ?? ""),
        last_attempted_at: String(g.last_attempted_at ?? ""),
        failure_ids: ids,
      });
    }

    db.close();
    return NextResponse.json({
      view: archived ? "archived" : "active",
      aggregated,
      attempts,
    });
  } catch (err) {
    console.error("[admin/money-owed-report]", err);
    return NextResponse.json({ error: "Failed to load money owed report" }, { status: 500 });
  }
}
