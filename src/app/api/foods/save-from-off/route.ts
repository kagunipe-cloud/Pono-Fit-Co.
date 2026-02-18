import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";
import { fetchOFFProduct, normalizeOFFProduct, type OFFProduct } from "@/lib/openfoodfacts";
import { normalizeServingSizeAndUnit, unitToGrams } from "@/lib/food-units";
import { validateFood, serializeDataQuality } from "@/lib/food-quality";

export const dynamic = "force-dynamic";

/**
 * POST — save one Open Food Facts product to our DB.
 * Body: { barcode: string } (we fetch from OFF) or { product: OFFProduct } (pre-fetched).
 * Runs macro validation and serving normalization; sets data_quality. If a food with this
 * barcode already exists (e.g. from USDA), adds cross_referenced flag.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let product: OFFProduct | null = null;

    if (body.product != null && typeof body.product === "object") {
      product = body.product as OFFProduct;
    } else if (body.barcode != null && String(body.barcode).trim()) {
      product = await fetchOFFProduct(String(body.barcode).trim());
    }

    if (!product) {
      return NextResponse.json({ error: "barcode or product required; product not found" }, { status: 400 });
    }

    let food = normalizeOFFProduct(product);
    if (!food) {
      return NextResponse.json({ error: "Could not normalize product" }, { status: 422 });
    }

    const { serving_size: rawSize, serving_size_unit: rawUnit, calories } = food;
    const normalized = normalizeServingSizeAndUnit(rawSize, rawUnit, calories);
    food = { ...food, serving_size: normalized.size, serving_size_unit: normalized.unit };
    if (food.serving_size != null && food.serving_size_unit != null) {
      food.serving_description = `${food.serving_size} ${food.serving_size_unit}`;
    }

    const servingSizeGrams =
      food.serving_size != null && food.serving_size_unit != null
        ? unitToGrams(food.serving_size, food.serving_size_unit)
        : null;
    const validation = validateFood(
      {
        calories: food.calories,
        protein_g: food.protein_g,
        fat_g: food.fat_g,
        carbs_g: food.carbs_g,
        fiber_g: food.fiber_g,
      },
      { servingSizeGrams: servingSizeGrams ?? undefined }
    );
    let dataQualityFlags = [...validation.dataQualityFlags];

    const db = getDb();
    ensureFoodsTable(db);
    const cols = db.prepare("PRAGMA table_info(foods)").all() as { name: string }[];
    const hasBarcode = cols.some((c) => c.name === "barcode");
    const hasDataQuality = cols.some((c) => c.name === "data_quality");

    const existingByBarcode = hasBarcode
      ? (db.prepare("SELECT id, source FROM foods WHERE barcode = ?").get(food.barcode) as { id: number; source: string } | undefined)
      : undefined;
    if (existingByBarcode) {
      if (!dataQualityFlags.includes("cross_referenced")) {
        dataQualityFlags.push("cross_referenced");
      }
    }

    const data_quality = serializeDataQuality(dataQualityFlags);

    if (existingByBarcode) {
      const id = existingByBarcode.id;
      if (hasBarcode && hasDataQuality) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ?, data_quality = ? WHERE id = ?"
        ).run(
          food.name,
          food.calories,
          food.protein_g,
          food.fat_g,
          food.carbs_g,
          food.fiber_g,
          food.serving_description,
          food.serving_size,
          food.serving_size_unit,
          data_quality,
          id
        );
      } else if (hasBarcode) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ? WHERE id = ?"
        ).run(
          food.name,
          food.calories,
          food.protein_g,
          food.fat_g,
          food.carbs_g,
          food.fiber_g,
          food.serving_description,
          food.serving_size,
          food.serving_size_unit,
          id
        );
      } else {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ? WHERE id = ?"
        ).run(
          food.name,
          food.calories,
          food.protein_g,
          food.fat_g,
          food.carbs_g,
          food.fiber_g,
          food.serving_description,
          id
        );
      }
      db.close();
      return NextResponse.json({
        id,
        name: food.name,
        barcode: food.barcode,
        source: "openfoodfacts",
        data_quality: dataQualityFlags,
        updated: true,
      });
    }

    if (hasBarcode && hasDataQuality) {
      const result = db
        .prepare(
          "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, barcode, serving_size, serving_size_unit, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, 'openfoodfacts', ?, ?, ?, ?)"
        )
        .run(
          food.name,
          food.calories,
          food.protein_g,
          food.fat_g,
          food.carbs_g,
          food.fiber_g,
          food.serving_description,
          food.barcode,
          food.serving_size,
          food.serving_size_unit,
          data_quality
        );
      const id = result.lastInsertRowid as number;
      db.close();
      return NextResponse.json({
        id,
        name: food.name,
        barcode: food.barcode,
        source: "openfoodfacts",
        data_quality: dataQualityFlags,
      });
    }

    if (hasBarcode) {
      const result = db
        .prepare(
          "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, barcode, serving_size, serving_size_unit) VALUES (?, ?, ?, ?, ?, ?, ?, 'openfoodfacts', ?, ?, ?)"
        )
        .run(
          food.name,
          food.calories,
          food.protein_g,
          food.fat_g,
          food.carbs_g,
          food.fiber_g,
          food.serving_description,
          food.barcode,
          food.serving_size,
          food.serving_size_unit
        );
      const id = result.lastInsertRowid as number;
      db.close();
      return NextResponse.json({ id, name: food.name, barcode: food.barcode, source: "openfoodfacts" });
    }

    const result = db
      .prepare(
        "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'openfoodfacts')"
      )
      .run(
        food.name,
        food.calories,
        food.protein_g,
        food.fat_g,
        food.carbs_g,
        food.fiber_g,
        food.serving_description
      );
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, name: food.name, source: "openfoodfacts" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save from Open Food Facts" }, { status: 500 });
  }
}
