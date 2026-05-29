import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";
import { addDaysToDateStr, todayInAppTz } from "@/lib/app-timezone";
import { getMacroBoardDayStatus, macroGoalsConfigured } from "@/lib/macro-board-scoring";

export const dynamic = "force-dynamic";

/** GET ?week=YYYY-MM-DD (Monday) — per-day totals + board status for that week. */
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
    const tz = getAppTimezone(db);
    const todayYmd = todayInAppTz(tz);

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      dates.push(addDaysToDateStr(week, i));
    }
    const weekEnd = dates[6]!;

    const macroGoal = db
      .prepare("SELECT member_id, calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?")
      .get(memberId) as
      | { member_id: string; calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null }
      | undefined;

    const dayCols = db.prepare("PRAGMA table_info(journal_days)").all() as { name: string }[];
    const hasFinishedCol = dayCols.some((c) => c.name === "macros_finished_at");
    const finishedSelect = hasFinishedCol ? ", macros_finished_at" : "";

    const days = db
      .prepare(`SELECT id, date${finishedSelect} FROM journal_days WHERE member_id = ? AND date >= ? AND date <= ?`)
      .all(memberId, dates[0], weekEnd) as { id: number; date: string; macros_finished_at?: string | null }[];

    const finishedByDate = new Map(days.map((d) => [d.date, d.macros_finished_at ?? null]));

    const out: Record<
      string,
      {
        cal: number;
        p: number;
        f: number;
        c: number;
        board: { hit: boolean; countable: boolean; finished: boolean; goals_configured: boolean };
      }
    > = {};

    const goalsConfigured = macroGoalsConfigured(macroGoal);

    for (const d of dates) {
      out[d] = {
        cal: 0,
        p: 0,
        f: 0,
        c: 0,
        board: {
          hit: false,
          countable: false,
          finished: false,
          goals_configured: goalsConfigured,
        },
      };
    }

    for (const day of days) {
      const meals = db.prepare("SELECT id FROM journal_meals WHERE journal_day_id = ?").all(day.id) as { id: number }[];
      let cal = 0,
        p = 0,
        f = 0,
        c = 0;
      for (const meal of meals) {
        const entries = db
          .prepare("SELECT e.food_id, e.amount FROM journal_meal_entries e WHERE e.journal_meal_id = ?")
          .all(meal.id) as { food_id: number; amount: number }[];
        for (const e of entries) {
          const food = db
            .prepare("SELECT calories, protein_g, fat_g, carbs_g FROM foods WHERE id = ?")
            .get(e.food_id) as
            | { calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null }
            | undefined;
          if (food) {
            cal += (food.calories ?? 0) * e.amount;
            p += (food.protein_g ?? 0) * e.amount;
            f += (food.fat_g ?? 0) * e.amount;
            c += (food.carbs_g ?? 0) * e.amount;
          }
        }
      }
      const totals = { cal, p, f, c };
      const boardStatus = getMacroBoardDayStatus(
        day.date,
        todayYmd,
        totals,
        macroGoal,
        finishedByDate.get(day.date)
      );
      out[day.date] = {
        ...totals,
        board: {
          hit: boardStatus.hit,
          countable: boardStatus.countable,
          finished: boardStatus.finished,
          goals_configured: boardStatus.goals_configured,
        },
      };
    }

    for (const d of dates) {
      if (days.some((day) => day.date === d)) continue;
      const boardStatus = getMacroBoardDayStatus(d, todayYmd, out[d], macroGoal, finishedByDate.get(d));
      out[d]!.board = {
        hit: boardStatus.hit,
        countable: boardStatus.countable,
        finished: boardStatus.finished,
        goals_configured: boardStatus.goals_configured,
      };
    }

    db.close();

    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get summary" }, { status: 500 });
  }
}
