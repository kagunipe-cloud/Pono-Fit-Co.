import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";

export const dynamic = "force-dynamic";

/**
 * GET ?barcode= — look up a food in our database by barcode.
 * Returns the food row if found (id, name, calories, protein_g, fat_g, carbs_g, etc.), 404 if not.
 * Barcode is normalized to digits only for lookup (many scanners add leading zeros or dashes).
 */
export async function GET(request: NextRequest) {
  try {
    const barcode = request.nextUrl.searchParams.get("barcode")?.trim();
    if (!barcode) {
      return NextResponse.json({ error: "barcode query required" }, { status: 400 });
    }
    const digitsOnly = barcode.replace(/\D/g, "");
    if (!digitsOnly) {
      return NextResponse.json({ error: "Invalid barcode" }, { status: 400 });
    }

    const db = getDb();
    ensureFoodsTable(db);
    const cols = db.prepare("PRAGMA table_info(foods)").all() as { name: string }[];
    const hasBarcode = cols.some((c) => c.name === "barcode");
    if (!hasBarcode) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Match exact barcode, digits-only, or stored barcode with spaces/dashes removed
    const food = db.prepare(
      "SELECT id, name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_size, serving_size_unit, serving_description, source, barcode FROM foods WHERE barcode = ? OR barcode = ? OR REPLACE(REPLACE(barcode, ' ', ''), '-', '') = ?"
    ).get(barcode, digitsOnly, digitsOnly) as Record<string, unknown> | undefined;
    db.close();

    if (!food) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(food);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to look up barcode" }, { status: 500 });
  }
}
