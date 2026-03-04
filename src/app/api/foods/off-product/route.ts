import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCachedOffProduct, setCachedOffProduct } from "@/lib/off-product-cache";
import { fetchOFFProduct, normalizeOFFProduct } from "@/lib/openfoodfacts";

export const dynamic = "force-dynamic";

/**
 * GET ?barcode= — fetch one product by barcode from Open Food Facts. Returns normalized food.
 * Results are cached persistently to reduce API calls when users re-scan the same products.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const barcode = searchParams.get("barcode")?.trim();

    if (!barcode) {
      return NextResponse.json({ error: "barcode query is required" }, { status: 400 });
    }

    const db = getDb();
    try {
      const cached = getCachedOffProduct(db, barcode);
      if (cached) return NextResponse.json(cached);

      const product = await fetchOFFProduct(barcode);
      if (!product) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }

      const normalized = normalizeOFFProduct(product);
      if (!normalized) {
        return NextResponse.json({ error: "Could not normalize product" }, { status: 422 });
      }

      setCachedOffProduct(db, barcode, normalized);
      return NextResponse.json(normalized);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Open Food Facts fetch failed" }, { status: 500 });
  }
}
