import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { ensureSaleRetailLinesTable } from "../../../../lib/retail-products";

export const dynamic = "force-dynamic";

type CategoryRow = { category: string; count: number; revenue: number; netRevenue: number };

function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

type SqliteDb = ReturnType<typeof getDb>;

/**
 * Older checkouts recorded PT pack purchases only on pt_credit_ledger (see pt_pack in confirm-payment).
 * Estimate dollars for attribution when pt_bookings has no $ for that sale. Skipped when bookings already carry PT $ (avoid double-count with session purchases that also ledger).
 */
function estimatePtPackPurchaseUsdFromLedger(db: SqliteDb, salesId: string): { usd: number; lineCount: number } {
  try {
    const rows = db
      .prepare(
        `SELECT duration_minutes, amount FROM pt_credit_ledger
         WHERE reference_type = 'sale' AND reference_id = ? AND reason = 'purchase'
         ORDER BY id ASC`
      )
      .all(salesId) as { duration_minutes: number | null; amount: number | string | null }[];
    if (rows.length === 0) return { usd: 0, lineCount: 0 };

    let usd = 0;
    let attributedLines = 0;
    for (const r of rows) {
      const amt = Math.max(0, Math.floor(Number(r.amount) || 0));
      const dm = Math.round(Number(r.duration_minutes) || 0);
      if (amt <= 0 || dm <= 0) continue;

      let packs = db
        .prepare(
          `SELECT credits, CAST(REPLACE(IFNULL(price, '0'), ',', '') AS REAL) AS price
           FROM pt_pack_products WHERE duration_minutes = ? AND credits IS NOT NULL AND credits > 0`
        )
        .all(dm) as { credits: number; price: number }[];
      packs = packs.filter((p) => amt % Math.floor(Number(p.credits) || 0) === 0);
      if (packs.length === 0) continue;
      packs.sort((a, b) => Math.floor(Number(b.credits) || 0) - Math.floor(Number(a.credits) || 0));
      const p = packs[0]!;
      const c = Math.max(1, Math.floor(Number(p.credits) || 1));
      const numSkus = amt / c;
      usd += (Number.isFinite(p.price) ? p.price : 0) * numSkus;
      attributedLines += 1;
    }
    return { usd, lineCount: attributedLines };
  } catch {
    return { usd: 0, lineCount: 0 };
  }
}

/** GET: Sales report by category (admin only). Query: from=YYYY-MM-DD&to=YYYY-MM-DD (optional).
 *  Category revenue is attributed proportionally from sales.grand_total so totals match.
 *  Net = gross - tax. */
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

    const sales = db.prepare(
      `SELECT s.sales_id, CAST(s.grand_total AS REAL) AS grand_total, CAST(s.tax_amount AS REAL) AS tax_amount, s.sale_type
       FROM sales s WHERE s.status != 'Refunded'${dateFilter}`
    ).all(...dateArgs) as { sales_id: string; grand_total: number; tax_amount: number; sale_type?: string | null }[];

    const totalCount = sales.length;
    const totalRevenue = sales.reduce((sum, s) => sum + (parseNum(s.grand_total) || 0), 0);
    const totalTaxCollected = sales.reduce((sum, s) => sum + (parseNum(s.tax_amount) || 0), 0);
    const totalNetRevenue = totalRevenue - totalTaxCollected;

    const categoryCounts: Record<string, number> = { Membership: 0, Class: 0, PT: 0, "Pro Shop": 0, Other: 0 };
    const categoryRevenue: Record<string, number> = { Membership: 0, Class: 0, PT: 0, "Pro Shop": 0, Other: 0 };
    const categoryNetRevenue: Record<string, number> = { Membership: 0, Class: 0, PT: 0, "Pro Shop": 0, Other: 0 };

    try {
      ensureSaleRetailLinesTable(db);
    } catch {
      /* optional table */
    }

    for (const sale of sales) {
      const sid = sale.sales_id;
      const grandTotal = parseNum(sale.grand_total) || 0;
      const taxAmount = parseNum(sale.tax_amount) || 0;
      const netTotal = Math.max(0, grandTotal - taxAmount);

      let memAmt = 0;
      let classAmt = 0;
      let ptAmt = 0;
      let retailAmt = 0;
      let subRows: { price: string | number | null; quantity: string | number | null }[] = [];
      let clsRows: { price: string | number | null; quantity: string | number | null }[] = [];
      let ptRows: { price: string | number | null; quantity: string | number | null }[] = [];
      let retailRows: { price: string | number | null; quantity: string | number | null }[] = [];

      try {
        subRows = db.prepare(
          "SELECT price, quantity FROM subscriptions WHERE sales_id = ?"
        ).all(sid) as { price: string | number | null; quantity: string | number | null }[];
        for (const r of subRows) {
          const qty = Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1);
          memAmt += parseNum(r.price) * qty;
        }
        if (memAmt > 0) categoryCounts.Membership += subRows.length;
      } catch {
        /* subscriptions table may not exist */
      }

      try {
        clsRows = db.prepare(
          "SELECT price, quantity FROM class_bookings WHERE sales_id = ?"
        ).all(sid) as { price: string | number | null; quantity: string | number | null }[];
        for (const r of clsRows) {
          const qty = Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1);
          classAmt += parseNum(r.price) * qty;
        }
        if (classAmt > 0) categoryCounts.Class += clsRows.length;
      } catch {
        /* class_bookings may not exist */
      }

      try {
        ptRows = db.prepare(
          "SELECT price, quantity FROM pt_bookings WHERE sales_id = ?"
        ).all(sid) as { price: string | number | null; quantity: string | number | null }[];
        for (const r of ptRows) {
          const qty = Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1);
          ptAmt += parseNum(r.price) * qty;
        }
      } catch {
        /* pt_bookings may not exist */
      }

      let ptLedgerBacked = 0;
      let ptLedgerLineCount = 0;
      if (ptAmt <= 0) {
        const est = estimatePtPackPurchaseUsdFromLedger(db, sid);
        ptLedgerBacked = est.usd;
        ptLedgerLineCount = est.lineCount;
      }
      const ptCombined = ptAmt + ptLedgerBacked;
      if (ptCombined > 0) categoryCounts.PT += ptAmt > 0 ? ptRows.length : Math.max(ptLedgerLineCount, 1);

      try {
        retailRows = db.prepare(
          `SELECT l.quantity, COALESCE(g.price, p.price) AS price
           FROM sale_retail_lines l
           LEFT JOIN retail_products p ON p.id = l.retail_product_id
           LEFT JOIN retail_product_groups g ON g.id = p.group_id
           WHERE l.sales_id = ?`
        ).all(sid) as { price: string | number | null; quantity: string | number | null }[];
        for (const r of retailRows) {
          const qty = Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1);
          retailAmt += parseNum(r.price) * qty;
        }
        if (retailAmt > 0) categoryCounts["Pro Shop"] += retailRows.length;
      } catch {
        /* sale_retail_lines may not exist */
      }

      const lineTotal = memAmt + classAmt + ptCombined + retailAmt;
      const saleType = (sale as { sale_type?: string | null }).sale_type ?? "";

      if (lineTotal > 0) {
        const memPct = memAmt / lineTotal;
        const classPct = classAmt / lineTotal;
        const ptPct = ptCombined / lineTotal;
        const retailPct = retailAmt / lineTotal;
        categoryRevenue.Membership += grandTotal * memPct;
        categoryRevenue.Class += grandTotal * classPct;
        categoryRevenue.PT += grandTotal * ptPct;
        categoryRevenue["Pro Shop"] += grandTotal * retailPct;
        categoryNetRevenue.Membership += netTotal * memPct;
        categoryNetRevenue.Class += netTotal * classPct;
        categoryNetRevenue.PT += netTotal * ptPct;
        categoryNetRevenue["Pro Shop"] += netTotal * retailPct;
      } else if (saleType === "renewal") {
        categoryCounts.Membership += 1;
        categoryRevenue.Membership += grandTotal;
        categoryNetRevenue.Membership += netTotal;
      } else if (saleType === "complimentary") {
        /** Complimentary rows store price 0 on line items; bucket by what was granted (matches transactions category filters). */
        if (subRows.length > 0) {
          categoryCounts.Membership += subRows.length;
          categoryRevenue.Membership += grandTotal;
          categoryNetRevenue.Membership += netTotal;
        } else if (clsRows.length > 0) {
          categoryCounts.Class += clsRows.length;
          categoryRevenue.Class += grandTotal;
          categoryNetRevenue.Class += netTotal;
        } else if (ptRows.length > 0) {
          categoryCounts.PT += ptRows.length;
          categoryRevenue.PT += grandTotal;
          categoryNetRevenue.PT += netTotal;
        } else if (retailRows.length > 0) {
          categoryCounts["Pro Shop"] += retailRows.length;
          categoryRevenue["Pro Shop"] += grandTotal;
          categoryNetRevenue["Pro Shop"] += netTotal;
        } else {
          categoryCounts.Other += 1;
          categoryRevenue.Other += grandTotal;
          categoryNetRevenue.Other += netTotal;
        }
      } else if (retailRows.length > 0) {
        /** Retail SKUs priced at 0 / missing joins — allocate full receipt to Pro Shop line count */
        categoryCounts["Pro Shop"] += retailRows.length;
        categoryRevenue["Pro Shop"] += grandTotal;
        categoryNetRevenue["Pro Shop"] += netTotal;
      } else {
        categoryCounts.Other += 1;
        categoryRevenue.Other += grandTotal;
        categoryNetRevenue.Other += netTotal;
      }
    }

    const byCategory: CategoryRow[] = [
      { category: "Membership", count: categoryCounts.Membership, revenue: categoryRevenue.Membership, netRevenue: categoryNetRevenue.Membership },
      { category: "Class", count: categoryCounts.Class, revenue: categoryRevenue.Class, netRevenue: categoryNetRevenue.Class },
      { category: "PT", count: categoryCounts.PT, revenue: categoryRevenue.PT, netRevenue: categoryNetRevenue.PT },
    ];
    if (categoryCounts["Pro Shop"] > 0 || categoryRevenue["Pro Shop"] > 0) {
      byCategory.push({
        category: "Pro Shop",
        count: categoryCounts["Pro Shop"],
        revenue: categoryRevenue["Pro Shop"],
        netRevenue: categoryNetRevenue["Pro Shop"],
      });
    }
    if (categoryCounts.Other > 0 || categoryRevenue.Other > 0) {
      byCategory.push({ category: "Other", count: categoryCounts.Other, revenue: categoryRevenue.Other, netRevenue: categoryNetRevenue.Other });
    }

    db.close();

    return NextResponse.json({
      totalCount,
      totalRevenue,
      totalTaxCollected,
      totalNetRevenue,
      byCategory,
      from: hasRange ? from : null,
      to: hasRange ? to : null,
    });
  } catch (err) {
    console.error("[admin/sales-report]", err);
    return NextResponse.json({ error: "Failed to load sales report" }, { status: 500 });
  }
}
