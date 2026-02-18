import { NextRequest, NextResponse } from "next/server";
import { fetchOFFProduct, normalizeOFFProduct } from "@/lib/openfoodfacts";

export const dynamic = "force-dynamic";

/**
 * GET ?barcode= — fetch one product by barcode from Open Food Facts. Returns normalized food.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const barcode = searchParams.get("barcode")?.trim();

    if (!barcode) {
      return NextResponse.json({ error: "barcode query is required" }, { status: 400 });
    }

    const product = await fetchOFFProduct(barcode);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const normalized = normalizeOFFProduct(product);
    if (!normalized) {
      return NextResponse.json({ error: "Could not normalize product" }, { status: 422 });
    }

    return NextResponse.json(normalized);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Open Food Facts fetch failed" }, { status: 500 });
  }
}
