import type { getDb } from "./db";
import { ensureDayPassCreditLedger } from "./day-pass-credits";
import { ensureGiftPassesTable } from "./db";
import { MEMBERSHIP_PLAN_JOIN_SQL } from "./mrr";
import { isPassPackPlan } from "./pass-packs";

type SqliteDb = ReturnType<typeof getDb>;

export const MEMBERSHIP_SUBCATEGORIES = [
  "Monthly recurring",
  "Monthly non-recurring",
  "Day pass",
  "Week pass",
  "Pass packs",
] as const;

export type MembershipSubcategory = (typeof MEMBERSHIP_SUBCATEGORIES)[number];

export type MembershipSubcategoryTotals = Record<
  MembershipSubcategory,
  { count: number; revenue: number; netRevenue: number }
>;

function emptyMembershipTotals(): MembershipSubcategoryTotals {
  return {
    "Monthly recurring": { count: 0, revenue: 0, netRevenue: 0 },
    "Monthly non-recurring": { count: 0, revenue: 0, netRevenue: 0 },
    "Day pass": { count: 0, revenue: 0, netRevenue: 0 },
    "Week pass": { count: 0, revenue: 0, netRevenue: 0 },
    "Pass packs": { count: 0, revenue: 0, netRevenue: 0 },
  };
}

function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function hasPassCredits(sub: { pass_credits_remaining?: unknown }): boolean {
  const pc = sub.pass_credits_remaining;
  return pc != null && String(pc).trim() !== "";
}

export function classifyPlanMembershipSubcategory(
  plan: { unit?: string | null; category?: string | null },
  saleType: string,
  memberAutoRenew: number,
  fromPassCredits: boolean
): MembershipSubcategory | null {
  if (fromPassCredits || isPassPackPlan(plan)) return "Pass packs";

  const unit = String(plan.unit ?? "").trim();
  if (unit === "Month") {
    if (saleType === "renewal") return "Monthly recurring";
    if (Number(memberAutoRenew) === 1) return "Monthly recurring";
    return "Monthly non-recurring";
  }
  if (unit === "Day") return "Day pass";
  if (unit === "Week") return "Week pass";
  return null;
}

/** Pass-pack purchases recorded only on day_pass_credit_ledger (no subscription row). */
export function hasDayPassCreditLedgerPurchase(db: SqliteDb, salesId: string): boolean {
  try {
    ensureDayPassCreditLedger(db);
    return (
      db
        .prepare(
          `SELECT 1 FROM day_pass_credit_ledger
           WHERE reference_type = 'sale' AND reference_id = ? AND reason = 'purchase'
           LIMIT 1`
        )
        .get(salesId) != null
    );
  } catch {
    return false;
  }
}

/** Catalog $ for pass-pack ledger lines when subscription rows carry no price. */
function estimatePassPackUsdFromLedger(db: SqliteDb, salesId: string): { usd: number; lineCount: number } {
  try {
    ensureDayPassCreditLedger(db);
    const rows = db
      .prepare(
        `SELECT amount FROM day_pass_credit_ledger
         WHERE reference_type = 'sale' AND reference_id = ? AND reason = 'purchase'
         ORDER BY id ASC`
      )
      .all(salesId) as { amount: number | string | null }[];
    if (rows.length === 0) return { usd: 0, lineCount: 0 };

    const plans = db
      .prepare(
        `SELECT length, CAST(REPLACE(IFNULL(price, '0'), ',', '') AS REAL) AS price
         FROM membership_plans
         WHERE TRIM(COALESCE(category, '')) = 'Passes'
           AND TRIM(COALESCE(unit, '')) = 'Day'
           AND length IS NOT NULL AND TRIM(length) != ''`
      )
      .all() as { length: string; price: number }[];

    let usd = 0;
    let attributedLines = 0;
    for (const r of rows) {
      const credits = Math.max(0, Math.floor(Number(r.amount) || 0));
      if (credits <= 0) continue;
      const matches = plans.filter((p) => {
        const len = Math.max(1, Math.floor(Number(p.length) || 0));
        return credits % len === 0;
      });
      if (matches.length === 0) continue;
      matches.sort((a, b) => Math.floor(Number(b.length) || 0) - Math.floor(Number(a.length) || 0));
      const plan = matches[0]!;
      const len = Math.max(1, Math.floor(Number(plan.length) || 1));
      usd += (Number.isFinite(plan.price) ? plan.price : 0) * (credits / len);
      attributedLines += 1;
    }
    return { usd, lineCount: attributedLines };
  } catch {
    return { usd: 0, lineCount: 0 };
  }
}

function giftPassLineAmounts(db: SqliteDb, salesId: string): { subcategory: MembershipSubcategory; usd: number }[] {
  try {
    ensureGiftPassesTable(db);
    const rows = db
      .prepare(
        `SELECT p.unit, p.category, p.price, p.length
         FROM gift_passes g
         JOIN membership_plans p ON p.id = g.membership_plan_id
         WHERE g.sales_id = ?`
      )
      .all(salesId) as {
      unit: string | null;
      category: string | null;
      price: string | null;
      length: string | null;
    }[];
    const out: { subcategory: MembershipSubcategory; usd: number }[] = [];
    for (const r of rows) {
      const sub = classifyPlanMembershipSubcategory(r, "", 0, false);
      if (!sub) continue;
      out.push({ subcategory: sub, usd: parseNum(r.price) });
    }
    return out;
  } catch {
    return [];
  }
}

export type MembershipLineAmounts = Record<MembershipSubcategory, { usd: number; lineCount: number }>;

/** Catalog/list-price $ per membership subcategory on one sale (before receipt-level split). */
export function getMembershipLineAmountsForSale(
  db: SqliteDb,
  salesId: string,
  saleType: string,
  memberId: string
): MembershipLineAmounts {
  const amounts: MembershipLineAmounts = {
    "Monthly recurring": { usd: 0, lineCount: 0 },
    "Monthly non-recurring": { usd: 0, lineCount: 0 },
    "Day pass": { usd: 0, lineCount: 0 },
    "Week pass": { usd: 0, lineCount: 0 },
    "Pass packs": { usd: 0, lineCount: 0 },
  };

  let memberAutoRenew = 0;
  try {
    const m = db
      .prepare("SELECT COALESCE(auto_renew, 0) AS auto_renew FROM members WHERE member_id = ?")
      .get(memberId) as { auto_renew: number } | undefined;
    memberAutoRenew = Number(m?.auto_renew) === 1 ? 1 : 0;
  } catch {
    /* members */
  }

  try {
    const subRows = db
      .prepare(
        `SELECT s.price, s.quantity, s.pass_credits_remaining,
                p.unit, p.category
         FROM subscriptions s
         LEFT JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL}
         WHERE s.sales_id = ?`
      )
      .all(salesId) as {
      price: string | number | null;
      quantity: string | number | null;
      pass_credits_remaining: number | string | null;
      unit: string | null;
      category: string | null;
    }[];

    for (const r of subRows) {
      const qty = Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1);
      const lineUsd = parseNum(r.price) * qty;
      const sub = classifyPlanMembershipSubcategory(
        r,
        saleType,
        memberAutoRenew,
        hasPassCredits(r)
      );
      if (!sub || lineUsd <= 0) continue;
      amounts[sub].usd += lineUsd;
      amounts[sub].lineCount += 1;
    }
  } catch {
    /* subscriptions */
  }

  const passEst = estimatePassPackUsdFromLedger(db, salesId);
  if (passEst.usd > 0) {
    amounts["Pass packs"].usd += passEst.usd;
    amounts["Pass packs"].lineCount += passEst.lineCount;
  } else if (hasDayPassCreditLedgerPurchase(db, salesId)) {
    amounts["Pass packs"].lineCount += 1;
  }

  for (const { subcategory, usd } of giftPassLineAmounts(db, salesId)) {
    if (usd > 0) {
      amounts[subcategory].usd += usd;
      amounts[subcategory].lineCount += 1;
    }
  }

  return amounts;
}

export function createEmptyMembershipSubcategoryTotals(): MembershipSubcategoryTotals {
  return emptyMembershipTotals();
}

/** Apply one sale's membership sub-lines to running totals (proportional gross/net split). */
export function addSaleMembershipSubcategoryTotals(
  totals: MembershipSubcategoryTotals,
  memLineAmounts: MembershipLineAmounts,
  memAmt: number,
  lineTotal: number,
  grandTotal: number,
  netTotal: number,
  saleType: string
): void {
  const memFromLines = MEMBERSHIP_SUBCATEGORIES.reduce((s, k) => s + memLineAmounts[k].usd, 0);
  const effectiveMemAmt = memAmt > 0 ? memAmt : memFromLines;

  if (effectiveMemAmt > 0 && lineTotal > 0) {
    const memShare = effectiveMemAmt / lineTotal;
    for (const sub of MEMBERSHIP_SUBCATEGORIES) {
      const subAmt = memLineAmounts[sub].usd;
      if (subAmt <= 0) continue;
      const subShare = subAmt / effectiveMemAmt;
      totals[sub].revenue += grandTotal * memShare * subShare;
      totals[sub].netRevenue += netTotal * memShare * subShare;
      if (memLineAmounts[sub].lineCount > 0) totals[sub].count += memLineAmounts[sub].lineCount;
    }
    return;
  }

  if (saleType === "renewal") {
    totals["Monthly recurring"].count += 1;
    totals["Monthly recurring"].revenue += grandTotal;
    totals["Monthly recurring"].netRevenue += netTotal;
    return;
  }

  if (hasDayPassCreditLedgerPurchaseOnly(memLineAmounts, saleType)) {
    totals["Pass packs"].count += Math.max(1, memLineAmounts["Pass packs"].lineCount);
    totals["Pass packs"].revenue += grandTotal;
    totals["Pass packs"].netRevenue += netTotal;
  }
}

function hasDayPassCreditLedgerPurchaseOnly(
  memLineAmounts: MembershipLineAmounts,
  saleType: string
): boolean {
  if (saleType === "renewal") return false;
  return memLineAmounts["Pass packs"].lineCount > 0 && memLineAmounts["Pass packs"].usd <= 0;
}

/** Complimentary / zero-price membership lines — bucket by subcategory from linked rows. */
export function addComplimentaryMembershipSubcategoryTotals(
  totals: MembershipSubcategoryTotals,
  memLineAmounts: MembershipLineAmounts,
  grandTotal: number,
  netTotal: number,
  subRowCount: number
): boolean {
  const lineCounts = MEMBERSHIP_SUBCATEGORIES.map((k) => memLineAmounts[k].lineCount);
  const totalMemLines = lineCounts.reduce((s, n) => s + n, 0);
  const hasMemLines = totalMemLines > 0;

  if (!hasMemLines && subRowCount > 0) {
    totals["Monthly non-recurring"].count += subRowCount;
    totals["Monthly non-recurring"].revenue += grandTotal;
    totals["Monthly non-recurring"].netRevenue += netTotal;
    return true;
  }
  if (!hasMemLines) return false;

  for (const sub of MEMBERSHIP_SUBCATEGORIES) {
    const n = memLineAmounts[sub].lineCount;
    if (n <= 0) continue;
    const share = n / totalMemLines;
    totals[sub].count += n;
    totals[sub].revenue += grandTotal * share;
    totals[sub].netRevenue += netTotal * share;
  }
  return true;
}

export function membershipSubcategoryToCategoryRows(
  totals: MembershipSubcategoryTotals
): { category: string; count: number; revenue: number; netRevenue: number }[] {
  return MEMBERSHIP_SUBCATEGORIES.map((category) => ({
    category,
    count: totals[category].count,
    revenue: totals[category].revenue,
    netRevenue: totals[category].netRevenue,
  }));
}

/** Sales ids whose membership lines fall in this subcategory (for drill-down). */
export function getSalesIdsForMembershipSubcategory(db: SqliteDb, subcategory: MembershipSubcategory): Set<string> {
  const ids = new Set<string>();
  if (!MEMBERSHIP_SUBCATEGORIES.includes(subcategory)) return ids;

  const sales = db
    .prepare("SELECT sales_id, member_id, sale_type FROM sales WHERE status != 'Refunded'")
    .all() as { sales_id: string; member_id: string; sale_type?: string | null }[];

  for (const sale of sales) {
    const sid = sale.sales_id;
    const saleType = sale.sale_type ?? "";
    const memLines = getMembershipLineAmountsForSale(db, sid, saleType, sale.member_id);

    if (memLines[subcategory].lineCount > 0 || memLines[subcategory].usd > 0) {
      ids.add(sid);
      continue;
    }

    if (subcategory === "Monthly recurring" && saleType === "renewal") {
      ids.add(sid);
      continue;
    }

    if (subcategory === "Pass packs" && hasDayPassCreditLedgerPurchase(db, sid)) {
      try {
        const hasSub = db.prepare("SELECT 1 FROM subscriptions WHERE sales_id = ? LIMIT 1").get(sid);
        const hasClass = db.prepare("SELECT 1 FROM class_bookings WHERE sales_id = ? LIMIT 1").get(sid);
        const hasPt = db.prepare("SELECT 1 FROM pt_bookings WHERE sales_id = ? LIMIT 1").get(sid);
        if (!hasSub && !hasClass && !hasPt) ids.add(sid);
      } catch {
        ids.add(sid);
      }
    }
  }

  return ids;
}
