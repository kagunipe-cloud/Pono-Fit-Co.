import type { getDb } from "./db";
import { addDaysToDateStr } from "./app-timezone";

type Db = ReturnType<typeof getDb>;

export type MacroGoalRow = {
  member_id?: string;
  calories_goal: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  carbs_pct: number | null;
};

export type MacroTotals = {
  cal: number;
  p: number;
  f: number;
  c: number;
};

export type MacroBoardDayStatus = {
  goals_configured: boolean;
  countable: boolean;
  finished: boolean;
  hit: boolean;
  miss_reasons: string[];
  tolerance_percent: number;
};

export const MACRO_GOAL_TOLERANCE_PERCENT = 15;
const MACRO_GOAL_TOLERANCE = MACRO_GOAL_TOLERANCE_PERCENT / 100;

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysToDateStr(cur, 1);
  }
  return out;
}

export function macroGoalsConfigured(goal: MacroGoalRow | undefined): boolean {
  if (!goal) return false;
  return Boolean(
    goal.calories_goal != null &&
      Number(goal.calories_goal) > 0 &&
      goal.protein_pct != null &&
      goal.fat_pct != null &&
      goal.carbs_pct != null
  );
}

function isWithinMacroTolerance(actual: number, goal: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(goal) || goal <= 0) return false;
  return Math.abs(actual - goal) <= goal * MACRO_GOAL_TOLERANCE;
}

export function macroGoalGramTargets(goal: MacroGoalRow): { calories: number; protein: number; fat: number; carbs: number } | null {
  const calories = Number(goal.calories_goal);
  const proteinPct = Number(goal.protein_pct);
  const fatPct = Number(goal.fat_pct);
  const carbsPct = Number(goal.carbs_pct);
  if (![calories, proteinPct, fatPct, carbsPct].every((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  return {
    calories,
    protein: (calories * (proteinPct / 100)) / 4,
    fat: (calories * (fatPct / 100)) / 9,
    carbs: (calories * (carbsPct / 100)) / 4,
  };
}

export function macroDayMissReasons(total: MacroTotals | undefined, goal: MacroGoalRow | undefined): string[] {
  if (!macroGoalsConfigured(goal)) return ["daily macro goals not set"];
  if (!total || total.cal <= 0) return ["no food logged"];
  const targets = macroGoalGramTargets(goal!);
  if (!targets) return ["daily macro goals incomplete"];

  const misses: string[] = [];
  if (!isWithinMacroTolerance(total.cal, targets.calories)) misses.push("calories");
  if (!isWithinMacroTolerance(total.p, targets.protein)) misses.push("protein");
  if (!isWithinMacroTolerance(total.f, targets.fat)) misses.push("fat");
  if (!isWithinMacroTolerance(total.c, targets.carbs)) misses.push("carbs");
  return misses;
}

export function macroDayHit(total: MacroTotals | undefined, goal: MacroGoalRow | undefined): boolean {
  return macroDayMissReasons(total, goal).length === 0;
}

export function isMacroDateCountable(date: string, todayYmd: string, manuallyFinishedDates: Set<string>): boolean {
  if (date > todayYmd) return false;
  if (date < todayYmd) return true;
  return manuallyFinishedDates.has(date);
}

export function getMacroBoardDayStatus(
  date: string,
  todayYmd: string,
  totals: MacroTotals | undefined,
  goal: MacroGoalRow | undefined,
  macrosFinishedAt: string | null | undefined
): MacroBoardDayStatus {
  const finished = Boolean(macrosFinishedAt);
  const manuallyFinishedDates = finished ? new Set([date]) : new Set<string>();
  const countable = isMacroDateCountable(date, todayYmd, manuallyFinishedDates);
  const missReasons = macroDayMissReasons(totals, goal);
  const goalsConfigured = macroGoalsConfigured(goal);
  const hit = countable && macroDayHit(totals, goal);

  return {
    goals_configured: goalsConfigured,
    countable,
    finished,
    hit,
    miss_reasons: missReasons,
    tolerance_percent: MACRO_GOAL_TOLERANCE_PERCENT,
  };
}

export function loadManualMacroFinishedDates(db: Db, weekStart: string, weekEnd: string): Map<string, Set<string>> {
  ensureJournalHasMacrosFinishedAt(db);
  const rows = db
    .prepare(
      `SELECT member_id, date FROM journal_days
       WHERE date >= ? AND date <= ? AND macros_finished_at IS NOT NULL`
    )
    .all(weekStart, weekEnd) as { member_id: string; date: string }[];
  const byMember = new Map<string, Set<string>>();
  for (const row of rows) {
    const memberId = String(row.member_id ?? "");
    if (!memberId) continue;
    const set = byMember.get(memberId) ?? new Set<string>();
    set.add(row.date);
    byMember.set(memberId, set);
  }
  return byMember;
}

export function macroPastCountableDaysInWeek(weekStart: string, weekEnd: string, todayYmd: string): number {
  let count = 0;
  for (const date of dateRange(weekStart, weekEnd)) {
    if (date < todayYmd) count += 1;
  }
  return count;
}

export function countMacroHitsInWeek(
  weekStart: string,
  weekEnd: string,
  todayYmd: string,
  totalsByDate: Map<string, MacroTotals> | undefined,
  goal: MacroGoalRow | undefined,
  finishedDates: Set<string>
): number {
  let hit = 0;
  for (const date of dateRange(weekStart, weekEnd)) {
    if (!isMacroDateCountable(date, todayYmd, finishedDates)) continue;
    if (macroDayHit(totalsByDate?.get(date), goal)) hit += 1;
  }
  return hit;
}

export function ensureJournalHasMacrosFinishedAt(db: Db): void {
  const dayCols = db.prepare("PRAGMA table_info(journal_days)").all() as { name: string }[];
  if (dayCols.some((c) => c.name === "macros_finished_at")) return;
  try {
    db.prepare("ALTER TABLE journal_days ADD COLUMN macros_finished_at TEXT").run();
  } catch {
    /* ignore */
  }
}
