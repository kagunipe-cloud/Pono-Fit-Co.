import type { getDb } from "./db";
import { weekStartInAppTz, todayInAppTz } from "./app-timezone";
import { ensureJournalTables } from "./journal";
import { ensureWorkoutTables } from "./workouts-server";
import { endOfDayInTz, startOfDayInTz, dateStringInAppTz } from "./app-timezone";
import { addDaysToDateStr } from "./app-timezone";

type Db = ReturnType<typeof getDb>;

export type WeighDirection = "at_or_below" | "at_or_above";

export type WeeklyPersonalGoals = {
  week_start: string;
  pr_exercise_id: number | null;
  pr_exercise_name: string | null;
  pr_weight_lbs: number | null;
  pr_reps: number | null;
  weigh_target_lbs: number | null;
  weigh_direction: WeighDirection | null;
};

export type WeeklyPersonalGoalProgress = WeeklyPersonalGoals & {
  pr_hit: boolean;
  weigh_hit: boolean;
  pr_percent: number | null;
  weigh_percent: number | null;
  pr_baseline_lbs: number | null;
  weigh_baseline_lbs: number | null;
  personal_hit: number;
  personal_target: number;
  personal_percent: number | null;
};

export function ensureMemberWeeklyPersonalGoalsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_weekly_personal_goals (
      member_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      pr_exercise_id INTEGER,
      pr_weight_lbs REAL,
      pr_reps INTEGER,
      weigh_target_lbs REAL,
      weigh_direction TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (member_id, week_start)
    );
    CREATE INDEX IF NOT EXISTS idx_member_weekly_personal_goals_week ON member_weekly_personal_goals(week_start);
  `);
}

function normalizePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v > 0 ? v : null;
}

function normalizePositiveFloat(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeWeighDirection(raw: unknown): WeighDirection | null {
  const s = String(raw ?? "").trim();
  if (s === "at_or_below" || s === "below") return "at_or_below";
  if (s === "at_or_above" || s === "above") return "at_or_above";
  return null;
}

function rowToGoals(
  weekStart: string,
  row:
    | {
        pr_exercise_id: number | null;
        pr_weight_lbs: number | null;
        pr_reps: number | null;
        weigh_target_lbs: number | null;
        weigh_direction: string | null;
        exercise_name?: string | null;
      }
    | undefined
): WeeklyPersonalGoals {
  const dir = normalizeWeighDirection(row?.weigh_direction);
  return {
    week_start: weekStart,
    pr_exercise_id: row?.pr_exercise_id != null ? Number(row.pr_exercise_id) : null,
    pr_exercise_name: row?.exercise_name?.trim() || null,
    pr_weight_lbs: row?.pr_weight_lbs != null ? Number(row.pr_weight_lbs) : null,
    pr_reps: row?.pr_reps != null ? Number(row.pr_reps) : null,
    weigh_target_lbs: row?.weigh_target_lbs != null ? Number(row.weigh_target_lbs) : null,
    weigh_direction: dir,
  };
}

function hasPrGoal(g: WeeklyPersonalGoals): boolean {
  return g.pr_exercise_id != null && g.pr_weight_lbs != null && g.pr_reps != null;
}

function hasWeighGoal(g: WeeklyPersonalGoals): boolean {
  return g.weigh_target_lbs != null && g.weigh_direction != null;
}

export function memberHasPersonalGoalConfigured(g: WeeklyPersonalGoals): boolean {
  return hasPrGoal(g) || hasWeighGoal(g);
}

function sqlBoundsForWeek(weekStart: string, weekEnd: string, tz: string): { fromSql: string; toSql: string } {
  return {
    fromSql: startOfDayInTz(weekStart, tz).replace("T", " ").slice(0, 19),
    toSql: endOfDayInTz(weekEnd, tz).replace("T", " ").slice(0, 19),
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Progress from start → goal based on current value (0–100). Works for increase or decrease goals. */
export function progressTowardGoal(current: number, start: number, goal: number): number {
  const needed = goal - start;
  if (Math.abs(needed) < 1e-9) {
    return Math.abs(current - goal) < 1e-9 ? 100 : 0;
  }
  const moved = needed > 0 ? current - start : start - current;
  return clampPercent((moved / Math.abs(needed)) * 100);
}

/** When counting this week's lifts, include in-progress workouts (sets log before Finish). Baseline/history stays finished-only. */
type LiftWeightQueryMode = "finished_before" | "in_week_including_in_progress";

function maxLiftWeightAtReps(
  db: Db,
  memberId: string,
  exerciseId: number,
  minReps: number,
  mode: LiftWeightQueryMode,
  fromSql: string,
  toSql?: string
): number | null {
  ensureWorkoutTables(db);
  let sql = `
    SELECT MAX(COALESCE(ws.weight_kg, 0)) AS max_w
    FROM workouts w
    JOIN workout_exercises we ON we.workout_id = w.id AND we.exercise_id = ? AND we.type = 'lift'
    JOIN workout_sets ws ON ws.workout_exercise_id = we.id
    WHERE w.member_id = ?
      AND COALESCE(ws.reps, 0) >= ?`;
  const params: (string | number)[] = [exerciseId, memberId, minReps];
  if (mode === "finished_before") {
    sql += " AND w.finished_at IS NOT NULL AND w.finished_at < ?";
    params.push(fromSql);
  } else {
    sql += " AND COALESCE(w.finished_at, w.started_at) >= ? AND COALESCE(w.finished_at, w.started_at) <= ?";
    params.push(fromSql, toSql!);
  }
  const row = db.prepare(sql).get(...params) as { max_w: number | null } | undefined;
  const maxW = row?.max_w != null ? Number(row.max_w) : null;
  return maxW != null && Number.isFinite(maxW) && maxW > 0 ? maxW : null;
}

function prGoalHitInRange(
  db: Db,
  memberId: string,
  exerciseId: number,
  minReps: number,
  goalWeight: number,
  fromSql: string,
  toSql: string,
  finishedOnly: boolean
): boolean {
  ensureWorkoutTables(db);
  const timeCol = finishedOnly ? "w.finished_at" : "COALESCE(w.finished_at, w.started_at)";
  const finishedClause = finishedOnly ? " AND w.finished_at IS NOT NULL" : "";
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id AND we.exercise_id = ? AND we.type = 'lift'
       JOIN workout_sets ws ON ws.workout_exercise_id = we.id
       WHERE w.member_id = ?
         ${finishedClause}
         AND ${timeCol} >= ?
         AND ${timeCol} <= ?
         AND COALESCE(ws.reps, 0) >= ?
         AND COALESCE(ws.weight_kg, 0) >= ?
       LIMIT 1`
    )
    .get(exerciseId, memberId, fromSql, toSql, minReps, goalWeight) as { ok: number } | undefined;
  return row != null;
}

function priorWeighIn(db: Db, memberId: string, beforeDate: string): number | null {
  ensureJournalTables(db);
  const row = db
    .prepare(
      `SELECT weight FROM member_weigh_ins
       WHERE member_id = ? AND date < ?
       ORDER BY date DESC
       LIMIT 1`
    )
    .get(memberId, beforeDate) as { weight: number } | undefined;
  const w = row?.weight != null ? Number(row.weight) : null;
  return w != null && Number.isFinite(w) && w > 0 ? w : null;
}

/** Earliest weigh-in logged during the week (starting weight when nothing exists before Monday). */
function firstWeighInThisWeek(db: Db, memberId: string, weekStart: string, weekEnd: string): number | null {
  ensureJournalTables(db);
  const row = db
    .prepare(
      `SELECT weight FROM member_weigh_ins
       WHERE member_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC
       LIMIT 1`
    )
    .get(memberId, weekStart, weekEnd) as { weight: number } | undefined;
  const w = row?.weight != null ? Number(row.weight) : null;
  return w != null && Number.isFinite(w) && w > 0 ? w : null;
}

function weighBaselineLbs(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string
): number | null {
  return priorWeighIn(db, memberId, weekStart) ?? firstWeighInThisWeek(db, memberId, weekStart, weekEnd);
}

function bestWeighInThisWeek(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  direction: WeighDirection
): number | null {
  ensureJournalTables(db);
  const agg = direction === "at_or_below" ? "MIN(weight)" : "MAX(weight)";
  const row = db
    .prepare(
      `SELECT ${agg} AS w FROM member_weigh_ins
       WHERE member_id = ? AND date >= ? AND date <= ?`
    )
    .get(memberId, weekStart, weekEnd) as { w: number | null } | undefined;
  const w = row?.w != null ? Number(row.w) : null;
  return w != null && Number.isFinite(w) && w > 0 ? w : null;
}

export function prGoalProgressPercent(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): number | null {
  if (!hasPrGoal(goal)) return null;
  const goalWeight = goal.pr_weight_lbs ?? 0;
  const minReps = goal.pr_reps ?? 0;
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  const baseline =
    maxLiftWeightAtReps(db, memberId, goal.pr_exercise_id!, minReps, "finished_before", fromSql) ?? 0;
  const current =
    maxLiftWeightAtReps(db, memberId, goal.pr_exercise_id!, minReps, "in_week_including_in_progress", fromSql, toSql) ??
    baseline;
  return progressTowardGoal(current, baseline, goalWeight);
}

export function weighGoalProgressPercent(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  goal: WeeklyPersonalGoals
): { percent: number | null; baseline_lbs: number | null; current_lbs: number | null } {
  if (!hasWeighGoal(goal)) return { percent: null, baseline_lbs: null, current_lbs: null };
  const target = goal.weigh_target_lbs ?? 0;
  const direction = goal.weigh_direction!;
  const baseline = weighBaselineLbs(db, memberId, weekStart, weekEnd);
  const currentBest = bestWeighInThisWeek(db, memberId, weekStart, weekEnd, direction);
  if (baseline == null) {
    return { percent: 0, baseline_lbs: null, current_lbs: currentBest };
  }
  const current = currentBest ?? baseline;
  return {
    percent: progressTowardGoal(current, baseline, target),
    baseline_lbs: baseline,
    current_lbs: current,
  };
}

export function prGoalBaselineLbs(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): number | null {
  if (!hasPrGoal(goal)) return null;
  const { fromSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  return maxLiftWeightAtReps(db, memberId, goal.pr_exercise_id!, goal.pr_reps ?? 0, "finished_before", fromSql);
}

export function prGoalHitThisWeek(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): boolean {
  if (!hasPrGoal(goal)) return false;
  ensureWorkoutTables(db);
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  return prGoalHitInRange(
    db,
    memberId,
    goal.pr_exercise_id!,
    goal.pr_reps ?? 0,
    goal.pr_weight_lbs ?? 0,
    fromSql,
    toSql,
    false
  );
}

export function weighGoalHitThisWeek(db: Db, memberId: string, weekStart: string, weekEnd: string, goal: WeeklyPersonalGoals): boolean {
  if (!hasWeighGoal(goal)) return false;
  ensureJournalTables(db);
  const rows = db
    .prepare(
      `SELECT weight FROM member_weigh_ins
       WHERE member_id = ? AND date >= ? AND date <= ?`
    )
    .all(memberId, weekStart, weekEnd) as { weight: number }[];
  for (const r of rows) {
    const w = Number(r.weight);
    if (!Number.isFinite(w)) continue;
    if (goal.weigh_direction === "at_or_below" && w <= (goal.weigh_target_lbs ?? 0)) return true;
    if (goal.weigh_direction === "at_or_above" && w >= (goal.weigh_target_lbs ?? 0)) return true;
  }
  return false;
}

export function scorePersonalGoals(
  db: Db,
  memberId: string,
  weekStart: string,
  tz: string,
  goal: WeeklyPersonalGoals
): {
  hit: number;
  target: number;
  percent: number | null;
  pr_percent: number | null;
  weigh_percent: number | null;
} | null {
  const weekEnd = addDaysToDateStr(weekStart, 6);
  const parts: number[] = [];
  let prPercent: number | null = null;
  let weighPercent: number | null = null;

  if (hasPrGoal(goal)) {
    prPercent = prGoalProgressPercent(db, memberId, weekStart, weekEnd, tz, goal);
    parts.push(prPercent ?? 0);
  }
  if (hasWeighGoal(goal)) {
    const weigh = weighGoalProgressPercent(db, memberId, weekStart, weekEnd, goal);
    weighPercent = weigh.percent;
    parts.push(weighPercent ?? 0);
  }

  if (parts.length === 0) return null;
  const percent = clampPercent(parts.reduce((sum, n) => sum + n, 0) / parts.length);
  return {
    hit: percent,
    target: 100,
    percent,
    pr_percent: prPercent,
    weigh_percent: weighPercent,
  };
}

export function getMemberWeeklyPersonalGoals(
  db: Db,
  memberId: string,
  tz: string,
  weekStart?: string
): WeeklyPersonalGoals {
  ensureMemberWeeklyPersonalGoalsTable(db);
  ensureWorkoutTables(db);
  const start = weekStart ?? weekStartInAppTz(todayInAppTz(tz));
  const row = db
    .prepare(
      `SELECT g.pr_exercise_id, g.pr_weight_lbs, g.pr_reps, g.weigh_target_lbs, g.weigh_direction,
              e.name AS exercise_name
       FROM member_weekly_personal_goals g
       LEFT JOIN exercises e ON e.id = g.pr_exercise_id
       WHERE g.member_id = ? AND g.week_start = ?`
    )
    .get(memberId, start) as
    | {
        pr_exercise_id: number | null;
        pr_weight_lbs: number | null;
        pr_reps: number | null;
        weigh_target_lbs: number | null;
        weigh_direction: string | null;
        exercise_name: string | null;
      }
    | undefined;
  return rowToGoals(start, row);
}

export function getMemberWeeklyPersonalGoalProgress(
  db: Db,
  memberId: string,
  tz: string,
  weekStart?: string
): WeeklyPersonalGoalProgress {
  const goals = getMemberWeeklyPersonalGoals(db, memberId, tz, weekStart);
  const weekEnd = addDaysToDateStr(goals.week_start, 6);
  const prHit = prGoalHitThisWeek(db, memberId, goals.week_start, weekEnd, tz, goals);
  const weighHit = weighGoalHitThisWeek(db, memberId, goals.week_start, weekEnd, goals);
  const scored = scorePersonalGoals(db, memberId, goals.week_start, tz, goals);
  const weighProgress = weighGoalProgressPercent(db, memberId, goals.week_start, weekEnd, goals);
  return {
    ...goals,
    pr_hit: prHit,
    weigh_hit: weighHit,
    pr_percent: scored?.pr_percent ?? null,
    weigh_percent: scored?.weigh_percent ?? null,
    pr_baseline_lbs: prGoalBaselineLbs(db, memberId, goals.week_start, weekEnd, tz, goals),
    weigh_baseline_lbs: weighProgress.baseline_lbs,
    personal_hit: scored?.hit ?? 0,
    personal_target: scored?.target ?? 0,
    personal_percent: scored?.percent ?? null,
  };
}

export type SaveWeeklyPersonalGoalsInput = {
  pr_exercise_id?: number | null;
  pr_weight_lbs?: number | null;
  pr_reps?: number | null;
  weigh_target_lbs?: number | null;
  weigh_direction?: WeighDirection | null;
  clear_pr?: boolean;
  clear_weigh?: boolean;
};

export function saveMemberWeeklyPersonalGoals(
  db: Db,
  memberId: string,
  tz: string,
  input: SaveWeeklyPersonalGoalsInput,
  weekStart?: string
): WeeklyPersonalGoals {
  ensureMemberWeeklyPersonalGoalsTable(db);
  ensureWorkoutTables(db);
  const start = weekStart ?? weekStartInAppTz(todayInAppTz(tz));
  const existing = getMemberWeeklyPersonalGoals(db, memberId, tz, start);

  let prExerciseId = existing.pr_exercise_id;
  let prWeight = existing.pr_weight_lbs;
  let prReps = existing.pr_reps;
  let weighTarget = existing.weigh_target_lbs;
  let weighDirection = existing.weigh_direction;

  if (input.clear_pr) {
    prExerciseId = null;
    prWeight = null;
    prReps = null;
  } else {
    if (input.pr_exercise_id !== undefined) {
      if (input.pr_exercise_id == null) {
        prExerciseId = null;
      } else {
        const ex = db.prepare("SELECT id FROM exercises WHERE id = ?").get(input.pr_exercise_id) as { id: number } | undefined;
        if (!ex) throw new Error("Exercise not found.");
        prExerciseId = ex.id;
      }
    }
    if (input.pr_weight_lbs !== undefined) {
      prWeight = input.pr_weight_lbs == null ? null : normalizePositiveFloat(input.pr_weight_lbs);
    }
    if (input.pr_reps !== undefined) {
      prReps = input.pr_reps == null ? null : normalizePositiveInt(input.pr_reps);
    }
  }

  if (input.clear_weigh) {
    weighTarget = null;
    weighDirection = null;
  } else {
    if (input.weigh_target_lbs !== undefined) {
      weighTarget = input.weigh_target_lbs == null ? null : normalizePositiveFloat(input.weigh_target_lbs);
    }
    if (input.weigh_direction !== undefined) {
      weighDirection = input.weigh_direction == null ? null : normalizeWeighDirection(input.weigh_direction);
    }
  }

  const prConfigured = prExerciseId != null || prWeight != null || prReps != null;
  if (prConfigured && (prExerciseId == null || prWeight == null || prReps == null)) {
    throw new Error("Lift PR goal needs exercise, weight (lbs), and reps.");
  }

  const weighConfigured = weighTarget != null || weighDirection != null;
  if (weighConfigured && (weighTarget == null || weighDirection == null)) {
    throw new Error("Weigh-in goal needs a target weight and above/below choice.");
  }

  const hasAny = (prExerciseId != null && prWeight != null && prReps != null) || (weighTarget != null && weighDirection != null);

  if (!hasAny) {
    db.prepare("DELETE FROM member_weekly_personal_goals WHERE member_id = ? AND week_start = ?").run(memberId, start);
    return rowToGoals(start, undefined);
  }

  db.prepare(
    `INSERT INTO member_weekly_personal_goals
       (member_id, week_start, pr_exercise_id, pr_weight_lbs, pr_reps, weigh_target_lbs, weigh_direction, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(member_id, week_start) DO UPDATE SET
       pr_exercise_id = excluded.pr_exercise_id,
       pr_weight_lbs = excluded.pr_weight_lbs,
       pr_reps = excluded.pr_reps,
       weigh_target_lbs = excluded.weigh_target_lbs,
       weigh_direction = excluded.weigh_direction,
       updated_at = datetime('now')`
  ).run(memberId, start, prExerciseId, prWeight, prReps, weighTarget, weighDirection);

  return getMemberWeeklyPersonalGoals(db, memberId, tz, start);
}

/** Load all personal goals for a week keyed by member_id (for goal board). */
export function loadWeeklyPersonalGoalsForWeek(db: Db, weekStart: string): Map<string, WeeklyPersonalGoals> {
  ensureMemberWeeklyPersonalGoalsTable(db);
  ensureWorkoutTables(db);
  const rows = db
    .prepare(
      `SELECT g.member_id, g.pr_exercise_id, g.pr_weight_lbs, g.pr_reps, g.weigh_target_lbs, g.weigh_direction,
              e.name AS exercise_name
       FROM member_weekly_personal_goals g
       LEFT JOIN exercises e ON e.id = g.pr_exercise_id
       WHERE g.week_start = ?`
    )
    .all(weekStart) as ({
      member_id: string;
      pr_exercise_id: number | null;
      pr_weight_lbs: number | null;
      pr_reps: number | null;
      weigh_target_lbs: number | null;
      weigh_direction: string | null;
      exercise_name: string | null;
    })[];
  const map = new Map<string, WeeklyPersonalGoals>();
  for (const row of rows) {
    map.set(String(row.member_id), rowToGoals(weekStart, row));
  }
  return map;
}
