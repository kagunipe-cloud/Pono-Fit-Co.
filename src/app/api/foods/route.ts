import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";
import { validateFood, serializeDataQuality } from "@/lib/food-quality";

export const dynamic = "force-dynamic";

type FoodRow = {
  id: number;
  name: string;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  fiber_g: number | null;
  serving_description: string | null;
  source: string | null;
  created_at: string | null;
};

/** GET ?q= — list all foods, optional search by name */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();

    const db = getDb();
    ensureFoodsTable(db);

    let sql = "SELECT id, name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, created_at FROM foods WHERE 1=1";
    const params: (string | number)[] = [];
    if (q.length > 0) {
      sql += " AND name LIKE ?";
      params.push(`%${q}%`);
    }
    sql += " ORDER BY name LIMIT 500";

    const rows = db.prepare(sql).all(...params) as FoodRow[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list foods" }, { status: 500 });
  }
}

/** POST — add one food. Body: { name, calories?, protein_g?, fat_g?, carbs_g?, fiber_g?, serving_description?, source? } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const calories = num(body.calories);
    const protein_g = num(body.protein_g ?? body.protein);
    const fat_g = num(body.fat_g ?? body.fat);
    const carbs_g = num(body.carbs_g ?? body.carbs ?? body.carbohydrates);
    const fiber_g = num(body.fiber_g ?? body.fiber);
    const serving_description = body.serving_description != null ? String(body.serving_description).trim() : null;
    const source = body.source != null ? String(body.source).trim() || "manual" : "manual";

    const validation = validateFood({ calories, protein_g, fat_g, carbs_g, fiber_g });
    const data_quality = serializeDataQuality(validation.dataQualityFlags);

    const db = getDb();
    ensureFoodsTable(db);
    const hasDataQuality = (db.prepare("PRAGMA table_info(foods)").all() as { name: string }[]).some((c) => c.name === "data_quality");
    if (hasDataQuality) {
      const result = db
        .prepare(
          "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, data_quality);
      const id = result.lastInsertRowid as number;
      db.close();
      return NextResponse.json({ id, name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, data_quality: validation.dataQualityFlags });
    }
    const result = db
      .prepare(
        "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source);
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add food" }, { status: 500 });
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}
