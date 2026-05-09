import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureRetailProductsTable, normalizeRetailSku, getMemberRetailSelfCheckoutEnabled } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

/**
 * GET — Active retail catalog for grab-and-go (member session required).
 * ?sku=... — resolve one product by barcode/SKU (scan flow).
 */
export async function GET(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const db = getDb();
  ensureRetailProductsTable(db);
  if (!getMemberRetailSelfCheckoutEnabled(db)) {
    db.close();
    return NextResponse.json(
      {
        error: "Self-checkout for the pro shop is not available yet. Please see the front desk.",
        code: "MEMBER_RETAIL_DISABLED",
      },
      { status: 403 }
    );
  }

  const sku = normalizeRetailSku(request.nextUrl.searchParams.get("sku"));
  try {
    if (sku) {
      const row = db
        .prepare("SELECT id, sku, name, price FROM retail_products WHERE sku = ? AND active = 1")
        .get(sku) as { id: number; sku: string; name: string; price: string } | undefined;
      db.close();
      if (!row) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      return NextResponse.json(row);
    }
    const rows = db
      .prepare("SELECT id, sku, name, price FROM retail_products WHERE active = 1 ORDER BY name COLLATE NOCASE")
      .all() as { id: number; sku: string; name: string; price: string }[];
    db.close();
    return NextResponse.json({ products: rows });
  } catch (e) {
    db.close();
    console.error("[member/retail-products]", e);
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}
