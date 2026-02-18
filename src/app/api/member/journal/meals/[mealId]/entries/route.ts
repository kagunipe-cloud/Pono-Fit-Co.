import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";
import { quantityAndMeasurementToAmount, unitToGrams } from "@/lib/food-units";

export const dynamic = "force-dynamic";

const OZ_TO_G = 28.349523125;

function toGrams(value: number, unit: string): number | null {
  const u = String(unit).toLowerCase().replace(/s$/, "");
  if (u === "g" || u === "gram") return value;
  if (u === "oz" || u === "ounce") return value * OZ_TO_G;
  return null;
}

/** POST — add food to meal. Body: { food_id, amount? } or { food_id, quantity, measurement? } or { food_id, portion_grams?, quantity?, measurement? } or { favorite_id }. Optional quantity+measurement stored for diary display. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mealId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const mealId = parseInt((await params).mealId, 10);
    if (Number.isNaN(mealId)) return NextResponse.json({ error: "Invalid meal id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const meal = db.prepare("SELECT jm.id FROM journal_meals jm JOIN journal_days jd ON jd.id = jm.journal_day_id WHERE jm.id = ? AND jd.member_id = ?").get(mealId, memberId) as { id: number } | undefined;
    if (!meal) {
      db.close();
      return NextResponse.json({ error: "Meal not found" }, { status: 404 });
    }

    const favoriteId = typeof body.favorite_id === "number" ? body.favorite_id : null;
    const foodId = typeof body.food_id === "number" ? body.food_id : null;
    const portionGrams = typeof body.portion_grams === "number" && body.portion_grams > 0 ? body.portion_grams : null;
    const quantity = typeof body.quantity === "number" ? body.quantity : parseFloat(String(body.quantity ?? ""));
    const measurement = typeof body.measurement === "string" ? body.measurement.trim() : null;
    let amount: number;

    const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM journal_meal_entries WHERE journal_meal_id = ?").get(mealId) as { m: number };
    let sortOrder = (maxOrder?.m ?? -1) + 1;
    const entryCols = db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[];
    const hasDisplayUnits = entryCols.some((c) => c.name === "quantity") && entryCols.some((c) => c.name === "measurement");
    const insertEntryBase = db.prepare("INSERT INTO journal_meal_entries (journal_meal_id, food_id, amount, sort_order) VALUES (?, ?, ?, ?)");
    const insertEntryWithDisplay = hasDisplayUnits
      ? db.prepare("INSERT INTO journal_meal_entries (journal_meal_id, food_id, amount, sort_order, quantity, measurement) VALUES (?, ?, ?, ?, ?, ?)")
      : null;

    if (favoriteId != null) {
      const items = db.prepare("SELECT food_id, amount, sort_order FROM member_favorite_items WHERE member_favorite_id = ? AND member_favorite_id IN (SELECT id FROM member_favorites WHERE member_id = ?) ORDER BY sort_order").all(favoriteId, memberId) as { food_id: number; amount: number; sort_order: number }[];
      for (const it of items) {
        if (insertEntryWithDisplay) insertEntryWithDisplay.run(mealId, it.food_id, it.amount, sortOrder++, null, null);
        else insertEntryBase.run(mealId, it.food_id, it.amount, sortOrder++);
      }
      db.close();
      return NextResponse.json({ added: items.length });
    }

    if (foodId == null) {
      db.close();
      return NextResponse.json({ error: "food_id or favorite_id required" }, { status: 400 });
    }
    const food = db.prepare("SELECT id, serving_size, serving_size_unit, serving_size_grams FROM foods WHERE id = ?").get(foodId) as {
      id: number;
      serving_size: number | null;
      serving_size_unit: string | null;
      serving_size_grams?: number | null;
    } | undefined;
    if (!food) {
      db.close();
      return NextResponse.json({ error: "Food not found" }, { status: 404 });
    }
    const servingGramsFromCol =
      typeof food.serving_size_grams === "number" && food.serving_size_grams > 0 ? food.serving_size_grams : null;
    const servingGrams =
      servingGramsFromCol ??
      (food.serving_size != null && food.serving_size_unit != null ? unitToGrams(food.serving_size, food.serving_size_unit) : null);

    if (!Number.isNaN(quantity) && quantity > 0 && measurement) {
      const computed = quantityAndMeasurementToAmount(
        quantity,
        measurement,
        food.serving_size,
        food.serving_size_unit
      );
      amount = computed != null && computed > 0 ? computed : parseFloat(String(body.amount ?? 1)) || 1;
    } else if (portionGrams != null) {
      const base = servingGrams;
      if (base != null && base > 0) {
        amount = portionGrams / base;
      } else {
        amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount ?? 1)) || 1;
      }
    } else {
      amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount ?? 1)) || 1;
    }

    const displayQuantity = !Number.isNaN(quantity) && quantity > 0 ? quantity : null;
    const displayMeasurement = measurement && measurement.length > 0 ? measurement : null;

    const runResult = insertEntryWithDisplay
      ? insertEntryWithDisplay.run(mealId, foodId, amount, sortOrder, displayQuantity, displayMeasurement)
      : insertEntryBase.run(mealId, foodId, amount, sortOrder);
    const id = runResult.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, journal_meal_id: mealId, food_id: foodId, amount, sort_order: sortOrder });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add entry" }, { status: 500 });
  }
}
