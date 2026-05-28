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
  /** Weight PR: hit this weight (lbs) for at least pr_weight_at_reps reps. */
  pr_weight_lbs: number | null;
  pr_weight_at_reps: number | null;
  /** Reps PR: hit this many reps at at least pr_reps_at_weight_lbs. */
  pr_reps_at_weight_lbs: number | null;
  pr_reps_target: number | null;
  weigh_target_lbs: number | null;
  weigh_direction: WeighDirection | null;
};

export type WeeklyPersonalGoalProgress = WeeklyPersonalGoals & {
  weight_pr_hit: boolean;
  reps_pr_hit: boolean;
  weigh_hit: boolean;
  weight_pr_percent: number | null;
  reps_pr_percent: number | null;
  weigh_percent: number | null;
  weight_pr_baseline_lbs: number | null;
  weight_pr_current_lbs: number | null;
  reps_pr_baseline: number | null;
  reps_pr_current: number | null;
  weigh_baseline_lbs: number | null;
  weigh_current_lbs: number | null;
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
  try {
    db.exec("ALTER TABLE member_weekly_personal_goals ADD COLUMN pr_reps_at_weight_lbs REAL");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE member_weekly_personal_goals ADD COLUMN pr_reps_target_reps INTEGER");
  } catch {
    /* already exists */
  }
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
        pr_reps_at_weight_lbs?: number | null;
        pr_reps_target_reps?: number | null;
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
    pr_weight_at_reps: row?.pr_reps != null ? Number(row.pr_reps) : null,
    pr_reps_at_weight_lbs: row?.pr_reps_at_weight_lbs != null ? Number(row.pr_reps_at_weight_lbs) : null,
    pr_reps_target: row?.pr_reps_target_reps != null ? Number(row.pr_reps_target_reps) : null,
    weigh_target_lbs: row?.weigh_target_lbs != null ? Number(row.weigh_target_lbs) : null,
    weigh_direction: dir,
  };
}

function hasWeightPrGoal(g: WeeklyPersonalGoals): boolean {
  return g.pr_exercise_id != null && g.pr_weight_lbs != null && g.pr_weight_at_reps != null;
}

function hasRepsPrGoal(g: WeeklyPersonalGoals): boolean {
  return g.pr_exercise_id != null && g.pr_reps_at_weight_lbs != null && g.pr_reps_target != null;
}

function hasWeighGoal(g: WeeklyPersonalGoals): boolean {
  return g.weigh_target_lbs != null && g.weigh_direction != null;
}

export function memberHasPersonalGoalConfigured(g: WeeklyPersonalGoals): boolean {
  return hasWeightPrGoal(g) || hasRepsPrGoal(g) || hasWeighGoal(g);
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

type LiftQueryMode = "finished_before" | "in_week_including_in_progress";

function maxLiftWeightAtReps(
  db: Db,
  memberId: string,
  exerciseId: number,
  minReps: number,
  mode: LiftQueryMode,
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

function maxRepsAtWeight(
  db: Db,
  memberId: string,
  exerciseId: number,
  minWeight: number,
  mode: LiftQueryMode,
  fromSql: string,
  toSql?: string
): number | null {
  ensureWorkoutTables(db);
  let sql = `
    SELECT MAX(COALESCE(ws.reps, 0)) AS max_r
    FROM workouts w
    JOIN workout_exercises we ON we.workout_id = w.id AND we.exercise_id = ? AND we.type = 'lift'
    JOIN workout_sets ws ON ws.workout_exercise_id = we.id
    WHERE w.member_id = ?
      AND COALESCE(ws.weight_kg, 0) >= ?`;
  const params: (string | number)[] = [exerciseId, memberId, minWeight];
  if (mode === "finished_before") {
    sql += " AND w.finished_at IS NOT NULL AND w.finished_at < ?";
    params.push(fromSql);
  } else {
    sql += " AND COALESCE(w.finished_at, w.started_at) >= ? AND COALESCE(w.finished_at, w.started_at) <= ?";
    params.push(fromSql, toSql!);
  }
  const row = db.prepare(sql).get(...params) as { max_r: number | null } | undefined;
  const maxR = row?.max_r != null ? Number(row.max_r) : null;
  return maxR != null && Number.isFinite(maxR) && maxR > 0 ? Math.floor(maxR) : null;
}

function weightPrHitInRange(
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

function repsPrHitInRange(
  db: Db,
  memberId: string,
  exerciseId: number,
  minWeight: number,
  goalReps: number,
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
         AND COALESCE(ws.weight_kg, 0) >= ?
         AND COALESCE(ws.reps, 0) >= ?
       LIMIT 1`
    )
    .get(exerciseId, memberId, fromSql, toSql, minWeight, goalReps) as { ok: number } | undefined;
  return row != null;
}

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

export function weightPrGoalProgress(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): { percent: number | null; baseline_lbs: number | null; current_lbs: number | null } {
  if (!hasWeightPrGoal(goal)) return { percent: null, baseline_lbs: null, current_lbs: null };
  const goalWeight = goal.pr_weight_lbs ?? 0;
  const minReps = goal.pr_weight_at_reps ?? 0;
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  const baseline =
    maxLiftWeightAtReps(db, memberId, goal.pr_exercise_id!, minReps, "finished_before", fromSql) ?? 0;
  const current =
    maxLiftWeightAtReps(db, memberId, goal.pr_exercise_id!, minReps, "in_week_including_in_progress", fromSql, toSql) ??
    baseline;
  return {
    percent: progressTowardGoal(current, baseline, goalWeight),
    baseline_lbs: baseline > 0 ? baseline : null,
    current_lbs: current > 0 ? current : null,
  };
}

export function repsPrGoalProgress(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): { percent: number | null; baseline_reps: number | null; current_reps: number | null } {
  if (!hasRepsPrGoal(goal)) return { percent: null, baseline_reps: null, current_reps: null };
  const goalWeight = goal.pr_reps_at_weight_lbs ?? 0;
  const goalReps = goal.pr_reps_target ?? 0;
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  const baseline =
    maxRepsAtWeight(db, memberId, goal.pr_exercise_id!, goalWeight, "finished_before", fromSql) ?? 0;
  const current =
    maxRepsAtWeight(db, memberId, goal.pr_exercise_id!, goalWeight, "in_week_including_in_progress", fromSql, toSql) ??
    baseline;
  return {
    percent: progressTowardGoal(current, baseline, goalReps),
    baseline_reps: baseline > 0 ? baseline : null,
    current_reps: current > 0 ? current : null,
  };
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
  const progressStart = firstWeighInThisWeek(db, memberId, weekStart, weekEnd);
  const currentBest = bestWeighInThisWeek(db, memberId, weekStart, weekEnd, goal.weigh_direction!);
  if (progressStart == null) {
    return { percent: 0, baseline_lbs: null, current_lbs: currentBest };
  }
  const current = currentBest ?? progressStart;
  return {
    percent: progressTowardGoal(current, progressStart, target),
    baseline_lbs: progressStart,
    current_lbs: current,
  };
}

export function weightPrGoalHitThisWeek(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): boolean {
  if (!hasWeightPrGoal(goal)) return false;
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  return weightPrHitInRange(
    db,
    memberId,
    goal.pr_exercise_id!,
    goal.pr_weight_at_reps ?? 0,
    goal.pr_weight_lbs ?? 0,
    fromSql,
    toSql,
    false
  );
}

export function repsPrGoalHitThisWeek(
  db: Db,
  memberId: string,
  weekStart: string,
  weekEnd: string,
  tz: string,
  goal: WeeklyPersonalGoals
): boolean {
  if (!hasRepsPrGoal(goal)) return false;
  const { fromSql, toSql } = sqlBoundsForWeek(weekStart, weekEnd, tz);
  return repsPrHitInRange(
    db,
    memberId,
    goal.pr_exercise_id!,
    goal.pr_reps_at_weight_lbs ?? 0,
    goal.pr_reps_target ?? 0,
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
  weight_pr_percent: number | null;
  reps_pr_percent: number | null;
  weigh_percent: number | null;
} | null {
  const weekEnd = addDaysToDateStr(weekStart, 6);
  const parts: number[] = [];
  let weightPrPercent: number | null = null;
  let repsPrPercent: number | null = null;
  let weighPercent: number | null = null;

  if (hasWeightPrGoal(goal)) {
    weightPrPercent = weightPrGoalProgress(db, memberId, weekStart, weekEnd, tz, goal).percent;
    parts.push(weightPrPercent ?? 0);
  }
  if (hasRepsPrGoal(goal)) {
    repsPrPercent = repsPrGoalProgress(db, memberId, weekStart, weekEnd, tz, goal).percent;
    parts.push(repsPrPercent ?? 0);
  }
  if (hasWeighGoal(goal)) {
    weighPercent = weighGoalProgressPercent(db, memberId, weekStart, weekEnd, goal).percent;
    parts.push(weighPercent ?? 0);
  }

  if (parts.length === 0) return null;
  const percent = clampPercent(parts.reduce((sum, n) => sum + n, 0) / parts.length);
  return {
    hit: percent,
    target: 100,
    percent,
    weight_pr_percent: weightPrPercent,
    reps_pr_percent: repsPrPercent,
    weigh_percent: weighPercent,
  };
}

const GOALS_SELECT = `
  SELECT g.pr_exercise_id, g.pr_weight_lbs, g.pr_reps, g.pr_reps_at_weight_lbs, g.pr_reps_target_reps,
         g.weigh_target_lbs, g.weigh_direction, e.name AS exercise_name`;

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
      `${GOALS_SELECT}
       FROM member_weekly_personal_goals g
       LEFT JOIN exercises e ON e.id = g.pr_exercise_id
       WHERE g.member_id = ? AND g.week_start = ?`
    )
    .get(memberId, start) as
    | {
        pr_exercise_id: number | null;
        pr_weight_lbs: number | null;
        pr_reps: number | null;
        pr_reps_at_weight_lbs: number | null;
        pr_reps_target_reps: number | null;
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
  const scored = scorePersonalGoals(db, memberId, goals.week_start, tz, goals);
  const weightProgress = weightPrGoalProgress(db, memberId, goals.week_start, weekEnd, tz, goals);
  const repsProgress = repsPrGoalProgress(db, memberId, goals.week_start, weekEnd, tz, goals);
  const weighProgress = weighGoalProgressPercent(db, memberId, goals.week_start, weekEnd, goals);
  return {
    ...goals,
    weight_pr_hit: weightPrGoalHitThisWeek(db, memberId, goals.week_start, weekEnd, tz, goals),
    reps_pr_hit: repsPrGoalHitThisWeek(db, memberId, goals.week_start, weekEnd, tz, goals),
    weigh_hit: weighGoalHitThisWeek(db, memberId, goals.week_start, weekEnd, goals),
    weight_pr_percent: scored?.weight_pr_percent ?? null,
    reps_pr_percent: scored?.reps_pr_percent ?? null,
    weigh_percent: scored?.weigh_percent ?? null,
    weight_pr_baseline_lbs: weightProgress.baseline_lbs,
    weight_pr_current_lbs: weightProgress.current_lbs,
    reps_pr_baseline: repsProgress.baseline_reps,
    reps_pr_current: repsProgress.current_reps,
    weigh_baseline_lbs: weighProgress.baseline_lbs,
    weigh_current_lbs: weighProgress.current_lbs,
    personal_hit: scored?.hit ?? 0,
    personal_target: scored?.target ?? 0,
    personal_percent: scored?.percent ?? null,
  };
}

export type SaveWeeklyPersonalGoalsInput = {
  pr_exercise_id?: number | null;
  pr_weight_lbs?: number | null;
  pr_weight_at_reps?: number | null;
  pr_reps_at_weight_lbs?: number | null;
  pr_reps_target?: number | null;
  /** @deprecated use pr_weight_at_reps */
  pr_reps?: number | null;
  weigh_target_lbs?: number | null;
  weigh_direction?: WeighDirection | null;
  clear_weight_pr?: boolean;
  clear_reps_pr?: boolean;
  /** Clears all lift goals including exercise. */
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
  let prWeightAtReps = existing.pr_weight_at_reps;
  let prRepsAtWeight = existing.pr_reps_at_weight_lbs;
  let prRepsTarget = existing.pr_reps_target;
  let weighTarget = existing.weigh_target_lbs;
  let weighDirection = existing.weigh_direction;

  if (input.clear_pr) {
    prExerciseId = null;
    prWeight = null;
    prWeightAtReps = null;
    prRepsAtWeight = null;
    prRepsTarget = null;
  } else {
    if (input.clear_weight_pr) {
      prWeight = null;
      prWeightAtReps = null;
    }
    if (input.clear_reps_pr) {
      prRepsAtWeight = null;
      prRepsTarget = null;
    }
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
    const repsAtRaw = input.pr_weight_at_reps !== undefined ? input.pr_weight_at_reps : input.pr_reps;
    if (repsAtRaw !== undefined) {
      prWeightAtReps = repsAtRaw == null ? null : normalizePositiveInt(repsAtRaw);
    }
    if (input.pr_reps_at_weight_lbs !== undefined) {
      prRepsAtWeight = input.pr_reps_at_weight_lbs == null ? null : normalizePositiveFloat(input.pr_reps_at_weight_lbs);
    }
    if (input.pr_reps_target !== undefined) {
      prRepsTarget = input.pr_reps_target == null ? null : normalizePositiveInt(input.pr_reps_target);
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

  const weightPrPartial = prWeight != null || prWeightAtReps != null;
  if (weightPrPartial && (prExerciseId == null || prWeight == null || prWeightAtReps == null)) {
    throw new Error("Weight PR needs exercise, target weight (lbs), and rep count.");
  }

  const repsPrPartial = prRepsAtWeight != null || prRepsTarget != null;
  if (repsPrPartial && (prExerciseId == null || prRepsAtWeight == null || prRepsTarget == null)) {
    throw new Error("Reps PR needs exercise, weight (lbs), and target reps.");
  }

  const weighConfigured = weighTarget != null || weighDirection != null;
  if (weighConfigured && (weighTarget == null || weighDirection == null)) {
    throw new Error("Weigh-in goal needs a target weight and above/below choice.");
  }

  const hasAny =
    (prExerciseId != null && prWeight != null && prWeightAtReps != null) ||
    (prExerciseId != null && prRepsAtWeight != null && prRepsTarget != null) ||
    (weighTarget != null && weighDirection != null);

  if (!hasAny) {
    db.prepare("DELETE FROM member_weekly_personal_goals WHERE member_id = ? AND week_start = ?").run(memberId, start);
    return rowToGoals(start, undefined);
  }

  if (prExerciseId == null && (prWeight != null || prWeightAtReps != null || prRepsAtWeight != null || prRepsTarget != null)) {
    throw new Error("Choose an exercise for your lift PR goal(s).");
  }

  db.prepare(
    `INSERT INTO member_weekly_personal_goals
       (member_id, week_start, pr_exercise_id, pr_weight_lbs, pr_reps, pr_reps_at_weight_lbs, pr_reps_target_reps,
        weigh_target_lbs, weigh_direction, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(member_id, week_start) DO UPDATE SET
       pr_exercise_id = excluded.pr_exercise_id,
       pr_weight_lbs = excluded.pr_weight_lbs,
       pr_reps = excluded.pr_reps,
       pr_reps_at_weight_lbs = excluded.pr_reps_at_weight_lbs,
       pr_reps_target_reps = excluded.pr_reps_target_reps,
       weigh_target_lbs = excluded.weigh_target_lbs,
       weigh_direction = excluded.weigh_direction,
       updated_at = datetime('now')`
  ).run(
    memberId,
    start,
    prExerciseId,
    prWeight,
    prWeightAtReps,
    prRepsAtWeight,
    prRepsTarget,
    weighTarget,
    weighDirection
  );

  return getMemberWeeklyPersonalGoals(db, memberId, tz, start);
}

/** Load all personal goals for a week keyed by member_id (for goal board). */
export function loadWeeklyPersonalGoalsForWeek(db: Db, weekStart: string): Map<string, WeeklyPersonalGoals> {
  ensureMemberWeeklyPersonalGoalsTable(db);
  ensureWorkoutTables(db);
  const rows = db
    .prepare(
      `${GOALS_SELECT}, g.member_id
       FROM member_weekly_personal_goals g
       LEFT JOIN exercises e ON e.id = g.pr_exercise_id
       WHERE g.week_start = ?`
    )
    .all(weekStart) as ({
      member_id: string;
      pr_exercise_id: number | null;
      pr_weight_lbs: number | null;
      pr_reps: number | null;
      pr_reps_at_weight_lbs: number | null;
      pr_reps_target_reps: number | null;
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
