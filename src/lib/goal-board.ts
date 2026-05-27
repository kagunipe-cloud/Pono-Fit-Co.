import type { getDb } from "./db";
import { ensureFoodsTable } from "./macros";
import { ensureJournalTables } from "./journal";
import {
  addDaysToDateStr,
  dateStringInAppTz,
  endOfDayInTz,
  startOfDayInTz,
  todayInAppTz,
  weekStartInAppTz,
} from "./app-timezone";
import { ensureWorkoutTables } from "./workouts-server";
import {
  loadWeeklyPersonalGoalsForWeek,
  memberHasPersonalGoalConfigured,
  scorePersonalGoals,
} from "./weekly-personal-goals";
import {
  countMacroHitsInWeek,
  ensureJournalHasMacrosFinishedAt,
  loadManualMacroFinishedDates,
  macroGoalsConfigured,
  macroPastCountableDaysInWeek,
  type MacroGoalRow,
  type MacroTotals,
} from "./macro-board-scoring";

type Db = ReturnType<typeof getDb>;

export type GoalMetric = {
  hit: number;
  target: number;
  percent: number | null;
};

export type GoalBoardRow = {
  rank: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  workout_goal_days: number | null;
  workouts: GoalMetric;
  macros: GoalMetric;
  personal_goal: GoalMetric | null;
  overall_percent: number | null;
};

export type GoalBoardPayload = {
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
  macro_countable_days: number;
  rows: GoalBoardRow[];
};

type MemberRow = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
};

const MACRO_WEEK_TARGET_DAYS = 7;

export function ensureMemberWorkoutGoalsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_workout_goals (
      member_id TEXT PRIMARY KEY,
      days_per_week INTEGER NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function normalizeWorkoutGoalDays(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  const days = Math.floor(n);
  if (days < 1 || days > 7) return null;
  return days;
}

function pct(hit: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((hit / target) * 100)));
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysToDateStr(cur, 1);
  }
  return out;
}

function displayName(m: Pick<MemberRow, "member_id" | "first_name" | "last_name">): string {
  return [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.member_id;
}

function sqlBoundsForWeek(weekStart: string, weekEnd: string, tz: string): { fromSql: string; toSql: string } {
  return {
    fromSql: startOfDayInTz(weekStart, tz).replace("T", " ").slice(0, 19),
    toSql: endOfDayInTz(weekEnd, tz).replace("T", " ").slice(0, 19),
  };
}

export function getMemberWorkoutGoal(db: Db, memberId: string): number | null {
  ensureMemberWorkoutGoalsTable(db);
  const row = db
    .prepare("SELECT days_per_week FROM member_workout_goals WHERE member_id = ?")
    .get(memberId) as { days_per_week: number | null } | undefined;
  return normalizeWorkoutGoalDays(row?.days_per_week);
}

export function setMemberWorkoutGoal(db: Db, memberId: string, daysPerWeek: number): void {
  const days = normalizeWorkoutGoalDays(daysPerWeek);
  if (days == null) throw new Error("Workout goal must be 1-7 days per week.");
  ensureMemberWorkoutGoalsTable(db);
  db.prepare(
    `INSERT INTO member_workout_goals (member_id, days_per_week, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(member_id) DO UPDATE SET days_per_week = excluded.days_per_week, updated_at = datetime('now')`
  ).run(memberId, days);
}

export function buildGoalBoard(db: Db, tz: string, weekStart?: string, today?: string): GoalBoardPayload {
  ensureMemberWorkoutGoalsTable(db);
  ensureWorkoutTables(db);
  ensureFoodsTable(db);
  ensureJournalTables(db);
  ensureJournalHasMacrosFinishedAt(db);

  const todayYmd = today ?? todayInAppTz(tz);
  const start = weekStart ?? weekStartInAppTz(todayYmd);
  const end = addDaysToDateStr(start, 6);
  const personalGoalsByMember = loadWeeklyPersonalGoalsForWeek(db, start);
  const manualMacroFinishedDates = loadManualMacroFinishedDates(db, start, end);
  const macroPastCountableDays = macroPastCountableDaysInWeek(start, end, todayYmd);

  const members = db
    .prepare(
      `SELECT member_id, first_name, last_name, role
       FROM members
       WHERE TRIM(IFNULL(member_id, '')) != ''
       ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE`
    )
    .all() as MemberRow[];
  const memberMap = new Map(members.map((m) => [m.member_id, m]));

  const workoutGoals = new Map<string, number>();
  const workoutGoalRows = db
    .prepare("SELECT member_id, days_per_week FROM member_workout_goals")
    .all() as { member_id: string; days_per_week: number | null }[];
  for (const row of workoutGoalRows) {
    const days = normalizeWorkoutGoalDays(row.days_per_week);
    if (days != null) workoutGoals.set(row.member_id, days);
  }

  const macroGoals = new Map<string, MacroGoalRow>();
  const macroGoalRows = db
    .prepare("SELECT member_id, calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals")
    .all() as MacroGoalRow[];
  for (const row of macroGoalRows) {
    if (!row.member_id) continue;
    macroGoals.set(row.member_id, row);
  }

  const { fromSql, toSql } = sqlBoundsForWeek(start, end, tz);
  const workoutDays = new Map<string, Set<string>>();
  const workoutRows = db
    .prepare(
      `SELECT member_id, finished_at FROM workouts
       WHERE finished_at IS NOT NULL AND finished_at >= ? AND finished_at <= ?`
    )
    .all(fromSql, toSql) as { member_id: string; finished_at: string | null }[];
  for (const row of workoutRows) {
    const memberId = String(row.member_id ?? "");
    if (!memberId || !row.finished_at) continue;
    const ymd = dateStringInAppTz(row.finished_at, tz);
    if (ymd < start || ymd > end) continue;
    const set = workoutDays.get(memberId) ?? new Set<string>();
    set.add(ymd);
    workoutDays.set(memberId, set);
  }

  const macroTotals = new Map<string, Map<string, MacroTotals>>();
  const totalsRows = db
    .prepare(
      `SELECT jd.member_id, jd.date,
              COALESCE(SUM(COALESCE(f.calories, 0) * COALESCE(e.amount, 0)), 0) AS cal,
              COALESCE(SUM(COALESCE(f.protein_g, 0) * COALESCE(e.amount, 0)), 0) AS p,
              COALESCE(SUM(COALESCE(f.fat_g, 0) * COALESCE(e.amount, 0)), 0) AS f,
              COALESCE(SUM(COALESCE(f.carbs_g, 0) * COALESCE(e.amount, 0)), 0) AS c
       FROM journal_days jd
       LEFT JOIN journal_meals jm ON jm.journal_day_id = jd.id
       LEFT JOIN journal_meal_entries e ON e.journal_meal_id = jm.id
       LEFT JOIN foods f ON f.id = e.food_id
       WHERE jd.date >= ? AND jd.date <= ?
       GROUP BY jd.member_id, jd.date`
    )
    .all(start, end) as ({ member_id: string; date: string } & MacroTotals)[];
  for (const row of totalsRows) {
    const memberId = String(row.member_id ?? "");
    if (!memberId) continue;
    const byDate = macroTotals.get(memberId) ?? new Map<string, MacroTotals>();
    byDate.set(row.date, {
      cal: Number(row.cal) || 0,
      p: Number(row.p) || 0,
      f: Number(row.f) || 0,
      c: Number(row.c) || 0,
    });
    macroTotals.set(memberId, byDate);
  }

  const candidates = new Set<string>();
  for (const id of workoutGoals.keys()) candidates.add(id);
  for (const id of macroGoals.keys()) candidates.add(id);
  for (const id of workoutDays.keys()) candidates.add(id);
  for (const id of macroTotals.keys()) candidates.add(id);
  for (const id of personalGoalsByMember.keys()) candidates.add(id);

  const rows: Omit<GoalBoardRow, "rank">[] = [];
  for (const memberId of candidates) {
    const member = memberMap.get(memberId);
    if (!member) continue;

    const workoutGoal = workoutGoals.get(memberId) ?? null;
    const workoutHit = workoutDays.get(memberId)?.size ?? 0;
    const workoutTarget = workoutGoal ?? 0;
    const workoutPercent = workoutGoal ? pct(workoutHit, workoutGoal) : null;

    const memberMacroTotals = macroTotals.get(memberId);
    const macroGoal = macroGoals.get(memberId);
    const finishedDates = manualMacroFinishedDates.get(memberId) ?? new Set<string>();
    const macroHit = countMacroHitsInWeek(start, end, todayYmd, memberMacroTotals, macroGoal, finishedDates);
    const macroTarget = MACRO_WEEK_TARGET_DAYS;
    const macroConfigured = macroGoalsConfigured(macroGoal);
    const macroPercent = macroConfigured ? pct(macroHit, macroTarget) : null;

    const personalGoalRow = personalGoalsByMember.get(memberId);
    const personalScored =
      personalGoalRow && memberHasPersonalGoalConfigured(personalGoalRow)
        ? scorePersonalGoals(db, memberId, start, tz, personalGoalRow)
        : null;
    const personalGoal: GoalMetric | null = personalScored
      ? {
          hit: personalScored.hit,
          target: personalScored.target,
          percent: personalScored.percent,
        }
      : null;
    const personalPercent = personalGoal?.percent ?? null;

    const scored = [workoutPercent, macroPercent, personalPercent].filter((n): n is number => n != null);
    const overall = scored.length > 0 ? Math.round(scored.reduce((sum, n) => sum + n, 0) / scored.length) : null;

    const hasSignal =
      workoutGoal != null ||
      workoutHit > 0 ||
      macroConfigured ||
      (memberMacroTotals != null && memberMacroTotals.size > 0) ||
      personalGoal != null;
    if (!hasSignal) continue;

    rows.push({
      member_id: member.member_id,
      first_name: member.first_name,
      last_name: member.last_name,
      display_name: displayName(member),
      workout_goal_days: workoutGoal,
      workouts: { hit: workoutHit, target: workoutTarget, percent: workoutPercent },
      macros: { hit: macroHit, target: macroTarget, percent: macroPercent },
      personal_goal: personalGoal,
      overall_percent: overall,
    });
  }

  rows.sort((a, b) => {
    const ao = a.overall_percent ?? -1;
    const bo = b.overall_percent ?? -1;
    if (bo !== ao) return bo - ao;
    const aw = a.workouts.percent ?? -1;
    const bw = b.workouts.percent ?? -1;
    if (bw !== aw) return bw - aw;
    const am = a.macros.percent ?? -1;
    const bm = b.macros.percent ?? -1;
    if (bm !== am) return bm - am;
    return a.display_name.localeCompare(b.display_name);
  });

  return {
    timezone: tz,
    today: todayYmd,
    week_start: start,
    week_end: end,
    macro_countable_days: macroPastCountableDays,
    rows: rows.map((r, i) => ({ ...r, rank: i + 1 })),
  };
}

/** Current-week scores for one member (member home + weekly goals page). */
export function getMemberWeeklyGoalMetrics(
  db: Db,
  memberId: string,
  tz: string
): {
  week_start: string;
  week_end: string;
  workout_days_per_week: number | null;
  macro_goals_set: boolean;
  workouts: GoalMetric;
  macros: GoalMetric;
  personal: GoalMetric | null;
} {
  ensureMemberWorkoutGoalsTable(db);
  ensureWorkoutTables(db);
  ensureFoodsTable(db);
  ensureJournalTables(db);

  ensureJournalTables(db);
  ensureJournalHasMacrosFinishedAt(db);

  const todayYmd = todayInAppTz(tz);
  const start = weekStartInAppTz(todayYmd);
  const end = addDaysToDateStr(start, 6);
  const manualMacroFinishedDates = loadManualMacroFinishedDates(db, start, end);
  const finishedDates = manualMacroFinishedDates.get(memberId) ?? new Set<string>();

  const workoutGoal = getMemberWorkoutGoal(db, memberId);
  const { fromSql, toSql } = sqlBoundsForWeek(start, end, tz);
  const workoutRows = db
    .prepare(
      `SELECT finished_at FROM workouts
       WHERE member_id = ? AND finished_at IS NOT NULL AND finished_at >= ? AND finished_at <= ?`
    )
    .all(memberId, fromSql, toSql) as { finished_at: string | null }[];
  const workoutDays = new Set<string>();
  for (const row of workoutRows) {
    if (!row.finished_at) continue;
    const ymd = dateStringInAppTz(row.finished_at, tz);
    if (ymd >= start && ymd <= end) workoutDays.add(ymd);
  }
  const workoutHit = workoutDays.size;
  const workoutTarget = workoutGoal ?? 0;
  const workoutPercent = workoutGoal ? pct(workoutHit, workoutGoal) : null;

  const macroGoal = db
    .prepare("SELECT calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?")
    .get(memberId) as MacroGoalRow | undefined;
  const macroGoalsSet = macroGoalsConfigured(macroGoal);

  const totalsRows = db
    .prepare(
      `SELECT jd.date,
              COALESCE(SUM(COALESCE(f.calories, 0) * COALESCE(e.amount, 0)), 0) AS cal,
              COALESCE(SUM(COALESCE(f.protein_g, 0) * COALESCE(e.amount, 0)), 0) AS p,
              COALESCE(SUM(COALESCE(f.fat_g, 0) * COALESCE(e.amount, 0)), 0) AS f,
              COALESCE(SUM(COALESCE(f.carbs_g, 0) * COALESCE(e.amount, 0)), 0) AS c
       FROM journal_days jd
       LEFT JOIN journal_meals jm ON jm.journal_day_id = jd.id
       LEFT JOIN journal_meal_entries e ON e.journal_meal_id = jm.id
       LEFT JOIN foods f ON f.id = e.food_id
       WHERE jd.member_id = ? AND jd.date >= ? AND jd.date <= ?
       GROUP BY jd.date`
    )
    .all(memberId, start, end) as ({ date: string } & MacroTotals)[];
  const macroByDate = new Map<string, MacroTotals>();
  for (const row of totalsRows) {
    macroByDate.set(row.date, {
      cal: Number(row.cal) || 0,
      p: Number(row.p) || 0,
      f: Number(row.f) || 0,
      c: Number(row.c) || 0,
    });
  }
  const macroHit = countMacroHitsInWeek(start, end, todayYmd, macroByDate, macroGoal, finishedDates);
  const macroTarget = MACRO_WEEK_TARGET_DAYS;
  const macroPercent = macroGoalsSet ? pct(macroHit, macroTarget) : null;

  const personalGoalRow = loadWeeklyPersonalGoalsForWeek(db, start).get(memberId);
  const personalScored =
    personalGoalRow && memberHasPersonalGoalConfigured(personalGoalRow)
      ? scorePersonalGoals(db, memberId, start, tz, personalGoalRow)
      : null;
  const personal: GoalMetric | null = personalScored
    ? { hit: personalScored.hit, target: personalScored.target, percent: personalScored.percent }
    : null;

  return {
    week_start: start,
    week_end: end,
    workout_days_per_week: workoutGoal,
    macro_goals_set: macroGoalsSet,
    workouts: { hit: workoutHit, target: workoutTarget, percent: workoutPercent },
    macros: { hit: macroHit, target: macroTarget, percent: macroPercent },
    personal,
  };
}

export type MemberGoalBoardPreview = {
  timezone: string;
  week_start: string;
  week_end: string;
  macro_countable_days: number;
  total_ranked: number;
  row: GoalBoardRow;
};

/** One member's ranked row (or unraked preview) for the member home mini board. */
export function getMemberGoalBoardPreview(db: Db, memberId: string, tz: string): MemberGoalBoardPreview {
  const todayYmd = todayInAppTz(tz);
  const board = buildGoalBoard(db, tz, undefined, todayYmd);
  const found = board.rows.find((r) => r.member_id === memberId);
  if (found) {
    return {
      timezone: board.timezone,
      week_start: board.week_start,
      week_end: board.week_end,
      macro_countable_days: board.macro_countable_days,
      total_ranked: board.rows.length,
      row: found,
    };
  }

  const metrics = getMemberWeeklyGoalMetrics(db, memberId, tz);
  const member = db
    .prepare("SELECT member_id, first_name, last_name FROM members WHERE member_id = ?")
    .get(memberId) as Pick<MemberRow, "member_id" | "first_name" | "last_name"> | undefined;
  if (!member) throw new Error("Member not found");

  const scored = [metrics.workouts.percent, metrics.macros.percent, metrics.personal?.percent ?? null].filter(
    (n): n is number => n != null
  );
  const overall = scored.length > 0 ? Math.round(scored.reduce((sum, n) => sum + n, 0) / scored.length) : null;

  return {
    timezone: board.timezone,
    week_start: metrics.week_start,
    week_end: metrics.week_end,
    macro_countable_days: board.macro_countable_days,
    total_ranked: board.rows.length,
    row: {
      rank: 0,
      member_id: memberId,
      first_name: member.first_name,
      last_name: member.last_name,
      display_name: displayName(member),
      workout_goal_days: metrics.workout_days_per_week,
      workouts: metrics.workouts,
      macros: metrics.macros,
      personal_goal: metrics.personal,
      overall_percent: overall,
    },
  };
}
