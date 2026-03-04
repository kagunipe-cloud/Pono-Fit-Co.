import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchCachedMacros } from "@/lib/ai-macros-cache";

export const dynamic = "force-dynamic";

/** GET ?q=... — return cached macro results that match the query (for suggest-as-you-type). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    if (!q.trim()) {
      return NextResponse.json([]);
    }
    const db = getDb();
    const rows = searchCachedMacros(db, q, 5);
    db.close();
    const results = rows.map((r) => {
      const food = r.food_key.split("|")[0] ?? r.food_key;
      return {
        food,
        calories: r.calories,
        protein_g: r.protein_g,
        fat_g: r.fat_g,
        carbs_g: r.carbs_g,
      };
    });
    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json([], { status: 500 });
  }
}
