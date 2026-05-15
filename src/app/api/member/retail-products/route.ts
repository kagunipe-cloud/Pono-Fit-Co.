import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import {
  ensureRetailProductsTable,
  normalizeRetailSku,
  getMemberRetailSelfCheckoutEnabled,
  getMemberRetailAllowPurchaseWhenOutOfStock,
  retailProductCanPurchaseForMemberCatalog,
} from "@/lib/retail-products";

export const dynamic = "force-dynamic";

const rowSelect = `
  SELECT p.id,
    CASE WHEN g.id IS NOT NULL THEN g.display_name || ' — ' || p.name ELSE p.name END AS name,
    COALESCE(g.price, p.price) AS price,
    COALESCE(c.name, '') AS category,
    COALESCE(p.stock_quantity, 0) AS stock_quantity
  FROM retail_products p
  LEFT JOIN retail_product_groups g ON g.id = p.group_id
  LEFT JOIN retail_categories c ON c.id = COALESCE(g.category_id, p.category_id)
  WHERE p.active = 1 AND (p.group_id IS NULL OR g.active = 1)
`;

/** Public-facing catalog row — no SKU or stock quantity exposed. */
function toPublicCatalogRow(
  r: { id: number; name: string; price: string; category: string; stock_quantity: number },
  allowWhenOutOfStock: boolean
) {
  return {
    id: r.id,
    name: r.name,
    price: r.price,
    category: r.category,
    can_purchase: retailProductCanPurchaseForMemberCatalog(r.stock_quantity, allowWhenOutOfStock),
  };
}

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
        error: "Self-checkout for the Pro Shop is not available yet. Please see the front desk.",
        code: "MEMBER_RETAIL_DISABLED",
      },
      { status: 403 }
    );
  }

  const allowWhenOutOfStock = getMemberRetailAllowPurchaseWhenOutOfStock(db);
  const sku = normalizeRetailSku(request.nextUrl.searchParams.get("sku"));
  try {
    if (sku) {
      const row = db.prepare(`${rowSelect} AND p.sku = ?`).get(sku) as
        | { id: number; name: string; price: string; category: string; stock_quantity: number }
        | undefined;
      db.close();
      if (!row) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      return NextResponse.json(toPublicCatalogRow(row, allowWhenOutOfStock));
    }
    const rows = db
      .prepare(
        `${rowSelect}
         ORDER BY COALESCE(c.sort_order, 999999), c.name COLLATE NOCASE, g.display_name COLLATE NOCASE, p.name COLLATE NOCASE`
      )
      .all() as { id: number; name: string; price: string; category: string; stock_quantity: number }[];
    db.close();
    return NextResponse.json({
      products: rows.map((r) => toPublicCatalogRow(r, allowWhenOutOfStock)),
    });
  } catch (e) {
    db.close();
    console.error("[member/retail-products]", e);
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}
