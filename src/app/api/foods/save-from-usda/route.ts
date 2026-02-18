import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";
import { getUnitType, normalizeServingSizeAndUnit, unitToGrams } from "@/lib/food-units";
import { validateFood, serializeDataQuality } from "@/lib/food-quality";

export const dynamic = "force-dynamic";

type USDAFoodNutrient = {
  nutrientId?: number;
  nutrient?: { id?: number; name?: string; unitName?: string };
  nutrientName?: string;
  unitName?: string;
  value?: number;
  amount?: number;
};

type USDAFood = {
  fdcId: number;
  description?: string;
  foodNutrients?: USDAFoodNutrient[];
  servingSize?: number;
  servingSizeUnit?: string;
};

function getNutrientId(n: USDAFoodNutrient): number | null {
  const id = n.nutrientId ?? n.nutrient?.id;
  return typeof id === "number" && !Number.isNaN(id) ? id : null;
}

function getAmount(n: USDAFoodNutrient): number | null {
  const v = n.value ?? n.amount;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const parsed = parseFloat(String(v));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * POST — save one USDA food to our DB (foods + food_nutrients). Body: USDA food object from search or GET food/{fdcId}.
 * If a food with this fdc_id already exists, we update it and replace its nutrients.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as USDAFood & { serving_grams?: number };
    const fdcId = typeof body.fdcId === "number" ? body.fdcId : null;
    if (fdcId == null) {
      return NextResponse.json({ error: "Body must include fdcId (USDA food id)" }, { status: 400 });
    }

    const name = String(body.description ?? "").trim() || "Unknown food";
    const foodNutrients = Array.isArray(body.foodNutrients) ? body.foodNutrients : [];

    const macroIds: Record<number, string> = {
      1008: "calories",
      1003: "protein_g",
      1004: "fat_g",
      1005: "carbs_g",
      1079: "fiber_g",
    };
    let calories: number | null = null;
    let protein_g: number | null = null;
    let fat_g: number | null = null;
    let carbs_g: number | null = null;
    let fiber_g: number | null = null;
    for (const fn of foodNutrients) {
      const id = getNutrientId(fn);
      const amount = getAmount(fn);
      if (id == null || amount == null) continue;
      const key = macroIds[id as number];
      if (key === "calories") calories = amount;
      else if (key === "protein_g") protein_g = amount;
      else if (key === "fat_g") fat_g = amount;
      else if (key === "carbs_g") carbs_g = amount;
      else if (key === "fiber_g") fiber_g = amount;
    }

    let servingSize = body.servingSize != null && !Number.isNaN(Number(body.servingSize)) ? Number(body.servingSize) : null;
    let servingSizeUnit = body.servingSizeUnit != null ? String(body.servingSizeUnit).trim() || null : null;
    const normalized = normalizeServingSizeAndUnit(servingSize, servingSizeUnit, calories);
    servingSize = normalized.size;
    servingSizeUnit = normalized.unit;
    // Store standard units for consistency (USDA/OFF sometimes use GRM, MLT, etc.)
    if (servingSizeUnit && /^grm(s)?$/i.test(servingSizeUnit.trim())) servingSizeUnit = "g";
    if (servingSizeUnit && /^mlt$/i.test(servingSizeUnit.trim())) servingSizeUnit = "ml";

    const servingSizeGrams =
      servingSize != null && servingSizeUnit
        ? unitToGrams(servingSize, servingSizeUnit)
        : null;
    const isVolumeServing = servingSize != null && servingSizeUnit != null && getUnitType(servingSizeUnit) === "volume";
    const clientServingGrams = typeof body.serving_grams === "number" && body.serving_grams > 0 ? body.serving_grams : null;

    // Volume serving without gram weight: API nutrients are per 100g, so normalize to 100g to avoid wrong "cal per tbsp"
    if (isVolumeServing && servingSizeGrams == null && clientServingGrams == null) {
      servingSize = 100;
      servingSizeUnit = "g";
    }
    // Default to 100 g when API doesn't provide a serving
    if (servingSize == null || servingSizeUnit == null) {
      servingSize = 100;
      servingSizeUnit = "g";
    }
    const servingDescFinal = `${servingSize} ${servingSizeUnit}`;
    const servingGramsForFactor = servingSizeGrams ?? clientServingGrams ?? 100;
    const perServingFactor = servingGramsForFactor > 0 ? servingGramsForFactor / 100 : 1;
    const servingSizeGramsToStore = servingSizeGrams ?? clientServingGrams ?? (servingSize === 100 && servingSizeUnit === "g" ? 100 : null);

    // Convert API per-100g to per-serving and store that (simpler: amount = serving multiplier everywhere)
    if (calories != null) calories = Math.round(calories * perServingFactor * 10) / 10;
    if (protein_g != null) protein_g = Math.round(protein_g * perServingFactor * 100) / 100;
    if (fat_g != null) fat_g = Math.round(fat_g * perServingFactor * 100) / 100;
    if (carbs_g != null) carbs_g = Math.round(carbs_g * perServingFactor * 100) / 100;
    if (fiber_g != null) fiber_g = Math.round(fiber_g * perServingFactor * 100) / 100;

    const validation = validateFood(
      { calories, protein_g, fat_g, carbs_g, fiber_g },
      { servingSizeGrams: servingGramsForFactor }
    );
    const dataQuality = serializeDataQuality(validation.dataQualityFlags);

    const db = getDb();
    ensureFoodsTable(db);

    const existing = db.prepare("SELECT id FROM foods WHERE fdc_id = ?").get(fdcId) as { id: number } | undefined;
    let foodId: number;
    const tableCols = db.prepare("PRAGMA table_info(foods)").all() as { name: string }[];
    const hasServingCols = tableCols.some((c) => c.name === "serving_size");
    const hasServingGramsCol = tableCols.some((c) => c.name === "serving_size_grams");
    const hasExtraCols = tableCols.some((c) => c.name === "data_quality");
    if (existing) {
      foodId = existing.id;
      if (hasServingCols && hasServingGramsCol && hasExtraCols) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ?, serving_size_grams = ?, data_quality = ? WHERE id = ?"
        ).run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, servingSize, servingSizeUnit, servingSizeGramsToStore, dataQuality, foodId);
      } else if (hasServingCols && hasServingGramsCol) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ?, serving_size_grams = ? WHERE id = ?"
        ).run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, servingSize, servingSizeUnit, servingSizeGramsToStore, foodId);
      } else if (hasServingCols && hasExtraCols) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ?, data_quality = ? WHERE id = ?"
        ).run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, servingSize, servingSizeUnit, dataQuality, foodId);
      } else if (hasServingCols) {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ?, serving_size = ?, serving_size_unit = ? WHERE id = ?"
        ).run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, servingSize, servingSizeUnit, foodId);
      } else {
        db.prepare(
          "UPDATE foods SET name = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, fiber_g = ?, serving_description = ? WHERE id = ?"
        ).run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, foodId);
      }
      db.prepare("DELETE FROM food_nutrients WHERE food_id = ?").run(foodId);
    } else {
      if (hasServingCols && hasServingGramsCol && hasExtraCols) {
        const result = db
          .prepare(
            "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id, serving_size, serving_size_unit, serving_size_grams, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda', ?, ?, ?, ?, ?)"
          )
          .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, fdcId, servingSize, servingSizeUnit, servingSizeGramsToStore, dataQuality);
        foodId = result.lastInsertRowid as number;
      } else if (hasServingCols && hasServingGramsCol) {
        const result = db
          .prepare(
            "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id, serving_size, serving_size_unit, serving_size_grams) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda', ?, ?, ?, ?)"
          )
          .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, fdcId, servingSize, servingSizeUnit, servingSizeGramsToStore);
        foodId = result.lastInsertRowid as number;
      } else if (hasServingCols && hasExtraCols) {
        const result = db
          .prepare(
            "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id, serving_size, serving_size_unit, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda', ?, ?, ?, ?)"
          )
          .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, fdcId, servingSize, servingSizeUnit, dataQuality);
        foodId = result.lastInsertRowid as number;
      } else if (hasServingCols) {
        const result = db
          .prepare(
            "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id, serving_size, serving_size_unit) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda', ?, ?, ?)"
          )
          .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, fdcId, servingSize, servingSizeUnit);
        foodId = result.lastInsertRowid as number;
      } else {
        const result = db
          .prepare(
            "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda', ?)"
          )
          .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, servingDescFinal, fdcId);
        foodId = result.lastInsertRowid as number;
      }
    }

    const insertNutrient = db.prepare(
      "INSERT OR IGNORE INTO nutrients (id, name, unit_name) VALUES (?, ?, ?)"
    );
    const insertFoodNutrient = db.prepare(
      "INSERT INTO food_nutrients (food_id, nutrient_id, amount) VALUES (?, ?, ?)"
    );
    for (const fn of foodNutrients) {
      const nutrientId = getNutrientId(fn);
      const rawAmount = getAmount(fn);
      if (nutrientId == null || rawAmount == null) continue;
      const amount = Math.round(rawAmount * perServingFactor * 1000) / 1000;
      const nutrientName = fn.nutrient?.name ?? fn.nutrientName ?? `Nutrient ${nutrientId}`;
      const unitName = fn.nutrient?.unitName ?? fn.unitName ?? "";
      insertNutrient.run(nutrientId, nutrientName, unitName);
      insertFoodNutrient.run(foodId, nutrientId, amount);
    }

    db.close();
    return NextResponse.json({ id: foodId, name, fdc_id: fdcId, serving_size: servingSize, serving_size_unit: servingSizeUnit });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save USDA food" }, { status: 500 });
  }
}
