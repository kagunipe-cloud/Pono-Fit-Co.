import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET — return current member's daily macro goals. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const goalCols = (db.prepare("PRAGMA table_info(member_macro_goals)").all() as { name: string }[]).map((c) => c.name);
    const selectCols = ["calories_goal", "protein_pct", "fat_pct", "carbs_pct"];
    if (goalCols.includes("weight_goal")) selectCols.push("weight_goal");
    if (goalCols.includes("fiber_goal")) selectCols.push("fiber_goal");
    const row = db.prepare(
      `SELECT ${selectCols.join(", ")} FROM member_macro_goals WHERE member_id = ?`
    ).get(memberId) as Record<string, number | null> | undefined;
    db.close();

    return NextResponse.json({
      calories_goal: row?.calories_goal ?? null,
      protein_pct: row?.protein_pct ?? null,
      fat_pct: row?.fat_pct ?? null,
      carbs_pct: row?.carbs_pct ?? null,
      weight_goal: goalCols.includes("weight_goal") ? (row?.weight_goal ?? null) : null,
      fiber_goal: goalCols.includes("fiber_goal") ? (row?.fiber_goal ?? null) : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get goals" }, { status: 500 });
  }
}

/** PATCH — update member's daily macro goals. Body: { calories_goal?, protein_pct?, fat_pct?, carbs_pct? }. Percentages 0–100; if only some set, others unchanged. */
export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const calories_goal = typeof body.calories_goal === "number" && body.calories_goal >= 0 ? Math.round(body.calories_goal) : body.calories_goal === null ? null : undefined;
    const protein_pct = typeof body.protein_pct === "number" && body.protein_pct >= 0 && body.protein_pct <= 100 ? body.protein_pct : body.protein_pct === null ? null : undefined;
    const fat_pct = typeof body.fat_pct === "number" && body.fat_pct >= 0 && body.fat_pct <= 100 ? body.fat_pct : body.fat_pct === null ? null : undefined;
    const carbs_pct = typeof body.carbs_pct === "number" && body.carbs_pct >= 0 && body.carbs_pct <= 100 ? body.carbs_pct : body.carbs_pct === null ? null : undefined;
    const weight_goal = typeof body.weight_goal === "number" && body.weight_goal > 0 ? body.weight_goal : body.weight_goal === null ? null : undefined;
    const fiber_goal = typeof body.fiber_goal === "number" && body.fiber_goal >= 0 ? body.fiber_goal : body.fiber_goal === null ? null : undefined;

    const db = getDb();
    ensureJournalTables(db);
    const existing = db.prepare("SELECT member_id, calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?").get(memberId) as { member_id: string; calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null } | undefined;
    const goalCols = db.prepare("PRAGMA table_info(member_macro_goals)").all() as { name: string }[];
    const hasWeightGoalCol = goalCols.some((c) => c.name === "weight_goal");
    const hasFiberGoalCol = goalCols.some((c) => c.name === "fiber_goal");
    if (!existing) {
      const cols = ["member_id", "calories_goal", "protein_pct", "fat_pct", "carbs_pct"];
      const vals = [memberId, calories_goal ?? null, protein_pct ?? null, fat_pct ?? null, carbs_pct ?? null];
      if (hasWeightGoalCol) { cols.push("weight_goal"); vals.push(weight_goal ?? null); }
      if (hasFiberGoalCol) { cols.push("fiber_goal"); vals.push(fiber_goal ?? null); }
      db.prepare(`INSERT INTO member_macro_goals (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
    } else {
      const cal = calories_goal !== undefined ? calories_goal : existing.calories_goal;
      const p = protein_pct !== undefined ? protein_pct : existing.protein_pct;
      const f = fat_pct !== undefined ? fat_pct : existing.fat_pct;
      const c = carbs_pct !== undefined ? carbs_pct : existing.carbs_pct;
      let setClause = "calories_goal = ?, protein_pct = ?, fat_pct = ?, carbs_pct = ?";
      const setVals: (number | null)[] = [cal ?? null, p ?? null, f ?? null, c ?? null];
      if (hasWeightGoalCol) {
        const existingWithWeight = db.prepare("SELECT weight_goal FROM member_macro_goals WHERE member_id = ?").get(memberId) as { weight_goal: number | null };
        const w = weight_goal !== undefined ? weight_goal : existingWithWeight?.weight_goal;
        setClause += ", weight_goal = ?";
        setVals.push(w ?? null);
      }
      if (hasFiberGoalCol) {
        const existingWithFiber = db.prepare("SELECT fiber_goal FROM member_macro_goals WHERE member_id = ?").get(memberId) as { fiber_goal: number | null };
        const fib = fiber_goal !== undefined ? fiber_goal : existingWithFiber?.fiber_goal;
        setClause += ", fiber_goal = ?";
        setVals.push(fib ?? null);
      }
      db.prepare(`UPDATE member_macro_goals SET ${setClause} WHERE member_id = ?`).run(...setVals, memberId);
    }
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update goals" }, { status: 500 });
  }
}
