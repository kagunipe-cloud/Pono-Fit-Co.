import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";

export const dynamic = "force-dynamic";

/**
 * GET — one food by id. Returns food row plus nutrients: { ...food, nutrients: [ { nutrient_id, name, unit_name, amount } ] }.
 * Optional ?tracked=1 with no auth: not used. Optional member session: if we add ?member_tracked=1 we could filter to that member's tracked nutrient_ids (later).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureFoodsTable(db);
    const food = db.prepare(
      "SELECT id, name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, fdc_id, created_at FROM foods WHERE id = ?"
    ).get(id) as Record<string, unknown> | undefined;
    if (!food) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const nutrients = db
      .prepare(
        `SELECT fn.nutrient_id, n.name, n.unit_name, fn.amount
         FROM food_nutrients fn
         JOIN nutrients n ON n.id = fn.nutrient_id
         WHERE fn.food_id = ?
         ORDER BY fn.nutrient_id`
      )
      .all(id) as { nutrient_id: number; name: string; unit_name: string | null; amount: number }[];
    db.close();

    return NextResponse.json({ ...food, nutrients });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get food" }, { status: 500 });
  }
}
