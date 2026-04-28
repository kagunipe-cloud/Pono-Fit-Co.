import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureSubscriptionRenewalDiscountPercentColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureDiscountsTable } from "@/lib/discounts";

export const dynamic = "force-dynamic";

/**
 * POST — Set `renewal_discount_percent` on active monthly subscriptions from the promo code
 * on the linked sale (`subscriptions.sales_id` → `sales.promo_code`).
 *
 * Body (optional): `{ "mode": "persistent_only" | "any_saved_code" }`
 * - persistent_only (default): only when the code exists in `discounts` with `applies_to_renewals = 1`.
 * - any_saved_code: any code that matches a row in `discounts` (grandfather existing checkouts before the flag existed).
 *
 * Only updates rows where `renewal_discount_percent` IS NULL. Admin only.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = (body.mode ?? "persistent_only") === "any_saved_code" ? "any_saved_code" : "persistent_only";

  try {
    const db = getDb();
    ensureDiscountsTable(db);
    ensureSubscriptionRenewalDiscountPercentColumn(db);

    let sql = `
      SELECT s.subscription_id, d.percent_off
      FROM subscriptions s
      INNER JOIN sales sa ON sa.sales_id = s.sales_id
      INNER JOIN membership_plans p ON p.product_id = s.product_id
      INNER JOIN discounts d ON UPPER(TRIM(d.code)) = UPPER(TRIM(sa.promo_code))
      WHERE s.status = 'Active'
        AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'
        AND sa.promo_code IS NOT NULL AND TRIM(sa.promo_code) != ''
        AND s.renewal_discount_percent IS NULL
    `;
    if (mode === "persistent_only") {
      sql += ` AND COALESCE(d.applies_to_renewals, 0) = 1`;
    }

    const rows = db.prepare(sql).all() as { subscription_id: string; percent_off: number }[];
    const upd = db.prepare("UPDATE subscriptions SET renewal_discount_percent = ? WHERE subscription_id = ?");
    let updated = 0;
    for (const r of rows) {
      const pct = Math.min(100, Math.max(0, Math.round(Number(r.percent_off) || 0)));
      if (pct <= 0 || pct >= 100) continue;
      upd.run(pct, r.subscription_id);
      updated += 1;
    }
    db.close();

    return NextResponse.json({
      ok: true,
      mode,
      matched: rows.length,
      updated,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Backfill failed." }, { status: 500 });
  }
}
