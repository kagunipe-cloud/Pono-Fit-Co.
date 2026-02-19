import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET ?week=YYYY-MM-DD (Monday) — returns per-day totals for that week: { [date]: { cal, p, f, c } }. */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const week = request.nextUrl.searchParams.get("week");
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: "week (YYYY-MM-DD Monday) required" }, { status: 400 });
    }

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(week + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const days = db.prepare(
      "SELECT id, date FROM journal_days WHERE member_id = ? AND date >= ? AND date <= ?"
    ).all(memberId, dates[0], dates[6]) as { id: number; date: string }[];

    const out: Record<string, { cal: number; p: number; f: number; c: number }> = {};
    for (const d of dates) out[d] = { cal: 0, p: 0, f: 0, c: 0 };

    for (const day of days) {
      const meals = db.prepare("SELECT id FROM journal_meals WHERE journal_day_id = ?").all(day.id) as { id: number }[];
      let cal = 0, p = 0, f = 0, c = 0;
      for (const meal of meals) {
        const entries = db.prepare(
          "SELECT e.food_id, e.amount FROM journal_meal_entries e WHERE e.journal_meal_id = ?"
        ).all(meal.id) as { food_id: number; amount: number }[];
        for (const e of entries) {
          const food = db.prepare("SELECT calories, protein_g, fat_g, carbs_g FROM foods WHERE id = ?").get(e.food_id) as { calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null } | undefined;
          if (food) {
            cal += (food.calories ?? 0) * e.amount;
            p += (food.protein_g ?? 0) * e.amount;
            f += (food.fat_g ?? 0) * e.amount;
            c += (food.carbs_g ?? 0) * e.amount;
          }
        }
      }
      out[day.date] = { cal, p, f, c };
    }
    db.close();

    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get summary" }, { status: 500 });
  }
}
