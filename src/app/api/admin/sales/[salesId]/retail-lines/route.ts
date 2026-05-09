import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getAdminMemberId } from "../../../../../../lib/admin";
import { ensureRetailProductsTable, ensureSaleRetailLinesTable } from "../../../../../../lib/retail-products";

export const dynamic = "force-dynamic";

/** GET — Admin only. Retail / physical line items captured for this sale (for refund re-stock prompt). */
export async function GET(request: NextRequest, context: { params: Promise<{ salesId: string }> }) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { salesId } = await context.params;
  const sales_id = (salesId ?? "").trim();
  if (!sales_id) {
    return NextResponse.json({ error: "salesId required" }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureRetailProductsTable(db);
    ensureSaleRetailLinesTable(db);
    const rows = db
      .prepare(
        `SELECT l.retail_product_id, l.quantity, p.sku, p.name
         FROM sale_retail_lines l
         JOIN retail_products p ON p.id = l.retail_product_id
         WHERE l.sales_id = ?
         ORDER BY p.name COLLATE NOCASE, p.sku COLLATE NOCASE`
      )
      .all(sales_id) as { retail_product_id: number; quantity: number; sku: string; name: string }[];
    db.close();

    const lines = rows.map((r) => ({
      retail_product_id: r.retail_product_id,
      quantity: Math.max(0, Math.floor(Number(r.quantity) || 0)),
      sku: String(r.sku ?? ""),
      name: String(r.name ?? ""),
    }));

    return NextResponse.json({ lines });
  } catch (err) {
    console.error("[sales/retail-lines]", err);
    return NextResponse.json({ error: "Failed to load retail lines" }, { status: 500 });
  }
}
