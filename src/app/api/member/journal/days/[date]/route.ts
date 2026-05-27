import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";
import { todayInAppTz } from "@/lib/app-timezone";
import { getMacroBoardDayStatus } from "@/lib/macro-board-scoring";

export const dynamic = "force-dynamic";

type FoodRow = { id: number; name: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; serving_size: number | null; serving_size_unit: string | null; serving_description: string | null; nutrients_per_100g?: number | null; source?: string };
type EntryRow = { id: number; journal_meal_id: number; food_id: number; amount: number; sort_order: number; quantity?: number | null; measurement?: string | null };
type MealRow = { id: number; journal_day_id: number; name: string; sort_order: number };

function sumDayTotals(
  db: ReturnType<typeof getDb>,
  meals: MealRow[]
): { cal: number; p: number; f: number; c: number } {
  const entryCols = (db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[]).map((c) => c.name);
  const hasDisplayUnits = entryCols.includes("quantity") && entryCols.includes("measurement");
  const entrySelect = hasDisplayUnits
    ? "SELECT id, journal_meal_id, food_id, amount, sort_order, quantity, measurement FROM journal_meal_entries"
    : "SELECT id, journal_meal_id, food_id, amount, sort_order FROM journal_meal_entries";
  const getFood = db.prepare("SELECT calories, protein_g, fat_g, carbs_g FROM foods WHERE id = ?");
  let cal = 0;
  let p = 0;
  let f = 0;
  let c = 0;
  for (const meal of meals) {
    const entries = db.prepare(`${entrySelect} WHERE journal_meal_id = ? ORDER BY sort_order, id`).all(meal.id) as EntryRow[];
    for (const e of entries) {
      const food = getFood.get(e.food_id) as FoodRow | undefined;
      if (!food) continue;
      const amount = Number(e.amount) || 0;
      cal += (Number(food.calories) || 0) * amount;
      p += (Number(food.protein_g) || 0) * amount;
      f += (Number(food.fat_g) || 0) * amount;
      c += (Number(food.carbs_g) || 0) * amount;
    }
  }
  return { cal, p, f, c };
}

/** GET — full day with meals and entries (each entry includes food name and macros). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const date = (await params).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const tz = getAppTimezone(db);
    const todayYmd = todayInAppTz(tz);
    const day = db.prepare("SELECT id, member_id, date, created_at, macros_finished_at FROM journal_days WHERE member_id = ? AND date = ?").get(memberId, date) as {
      id: number;
      member_id: string;
      date: string;
      created_at: string;
      macros_finished_at?: string | null;
    } | undefined;
    if (!day) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const meals = db.prepare("SELECT id, journal_day_id, name, sort_order FROM journal_meals WHERE journal_day_id = ? ORDER BY sort_order, id").all(day.id) as MealRow[];
    const foodCols = (db.prepare("PRAGMA table_info(foods)").all() as { name: string }[]).map((c) => c.name);
    const hasServingCols = foodCols.includes("serving_size");
    const hasNutrientsPer100g = foodCols.includes("nutrients_per_100g");
    const foodSelectCols = ["id", "name", "calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "serving_size", "serving_size_unit", "serving_description"];
    if (hasNutrientsPer100g) foodSelectCols.push("nutrients_per_100g");
    if (foodCols.includes("source")) foodSelectCols.push("source");
    const getFood = db.prepare(`SELECT ${foodSelectCols.join(", ")} FROM foods WHERE id = ?`);
    const entryCols = (db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[]).map((c) => c.name);
    const hasDisplayUnits = entryCols.includes("quantity") && entryCols.includes("measurement");
    const entrySelect = hasDisplayUnits
      ? "SELECT id, journal_meal_id, food_id, amount, sort_order, quantity, measurement FROM journal_meal_entries"
      : "SELECT id, journal_meal_id, food_id, amount, sort_order FROM journal_meal_entries";
    const mealsWithEntries = meals.map((meal) => {
      const entries = db.prepare(`${entrySelect} WHERE journal_meal_id = ? ORDER BY sort_order, id`).all(meal.id) as EntryRow[];
      const entriesWithFood = entries.map((e) => {
        const food = getFood.get(e.food_id) as FoodRow | undefined;
        return {
          id: e.id,
          food_id: e.food_id,
          amount: e.amount,
          sort_order: e.sort_order,
          ...(hasDisplayUnits && { quantity: e.quantity ?? undefined, measurement: e.measurement ?? undefined }),
          food: food
            ? {
                id: food.id,
                name: food.name,
                calories: food.calories,
                protein_g: food.protein_g,
                fat_g: food.fat_g,
                carbs_g: food.carbs_g,
                fiber_g: food.fiber_g,
                ...(hasServingCols && { serving_size: food.serving_size ?? undefined, serving_size_unit: food.serving_size_unit ?? undefined, serving_description: food.serving_description ?? undefined }),
                ...(hasNutrientsPer100g && { nutrients_per_100g: (food as FoodRow).nutrients_per_100g ?? undefined }),
                ...(foodCols.includes("source") && { source: (food as FoodRow).source ?? undefined }),
              }
            : null,
        };
      });
      return { ...meal, entries: entriesWithFood };
    });

    const dayTotals = sumDayTotals(db, meals);
    const macroGoal = db
      .prepare("SELECT member_id, calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?")
      .get(memberId) as
      | { member_id: string; calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null }
      | undefined;
    const board_macros = getMacroBoardDayStatus(date, todayYmd, dayTotals, macroGoal, day.macros_finished_at ?? null);

    db.close();
    return NextResponse.json({ ...day, meals: mealsWithEntries, board_macros });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get day" }, { status: 500 });
  }
}

/** PATCH — finish or reopen macro log for The Board. Body: { finish: true | false } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const date = (await params).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (body.finish !== true && body.finish !== false) {
      return NextResponse.json({ error: "finish must be true or false" }, { status: 400 });
    }

    const db = getDb();
    ensureJournalTables(db);
    const tz = getAppTimezone(db);
    const todayYmd = todayInAppTz(tz);
    if (date > todayYmd) {
      db.close();
      return NextResponse.json({ error: "Cannot finish a future day." }, { status: 400 });
    }

    const row = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(memberId, date) as { id: number } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.finish === false && date < todayYmd) {
      db.close();
      return NextResponse.json({ error: "Past days lock automatically at midnight and cannot be reopened." }, { status: 400 });
    }

    if (body.finish === true) {
      db.prepare("UPDATE journal_days SET macros_finished_at = datetime('now') WHERE id = ?").run(row.id);
    } else {
      db.prepare("UPDATE journal_days SET macros_finished_at = NULL WHERE id = ?").run(row.id);
    }

    const day = db.prepare("SELECT id, member_id, date, created_at, macros_finished_at FROM journal_days WHERE id = ?").get(row.id) as {
      id: number;
      member_id: string;
      date: string;
      created_at: string;
      macros_finished_at: string | null;
    };
    const meals = db.prepare("SELECT id, journal_day_id, name, sort_order FROM journal_meals WHERE journal_day_id = ? ORDER BY sort_order, id").all(row.id) as MealRow[];
    const dayTotals = sumDayTotals(db, meals);
    const macroGoal = db
      .prepare("SELECT member_id, calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?")
      .get(memberId) as
      | { member_id: string; calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null }
      | undefined;
    const board_macros = getMacroBoardDayStatus(date, todayYmd, dayTotals, macroGoal, day.macros_finished_at);

    db.close();
    return NextResponse.json({ ok: true, macros_finished_at: day.macros_finished_at, board_macros });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update day" }, { status: 500 });
  }
}

/** DELETE — remove journal day and all its meals/entries. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const date = (await params).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const db = getDb();
    ensureJournalTables(db);
    const row = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(memberId, date);
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM journal_days WHERE id = ?").run((row as { id: number }).id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete day" }, { status: 500 });
  }
}
