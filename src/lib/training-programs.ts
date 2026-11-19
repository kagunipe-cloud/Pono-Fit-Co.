import type Database from "better-sqlite3";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";

export const TRAINING_PHASES = ["DELOAD", "VOLUME", "HYPERTROPHY", "POWER", "PEAK"] as const;
export type TrainingPhase = (typeof TRAINING_PHASES)[number];

/** Default load bump when client hits rep target (trainer can override per lift/rule). */
export const DEFAULT_PHASE_STEP_PERCENT: Record<TrainingPhase, number> = {
  DELOAD: -10,
  VOLUME: 2.5,
  HYPERTROPHY: 5,
  POWER: 3,
  PEAK: 2.5,
};

export function parseTrainingPhase(raw: unknown): TrainingPhase {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if ((TRAINING_PHASES as readonly string[]).includes(s)) return s as TrainingPhase;
  return "HYPERTROPHY";
}

export function roundWeightToNearest5Lbs(lbs: number): number {
  if (!Number.isFinite(lbs) || lbs <= 0) return 0;
  return Math.round(lbs / 5) * 5;
}

/** When a % bump rounds to the same 5 lb plate, add this many reps per set instead. */
export const REP_BUMP_WHEN_WEIGHT_FLAT = 3;

export function nextWeightAfterStepPercent(fromLb: number, stepPct: number): number {
  const rawNext = fromLb * (1 + stepPct / 100);
  return roundWeightToNearest5Lbs(Math.max(5, rawNext));
}

/** True when rounding to 5 lb would not move the bar (< ~2.5 lb effective increase). */
export function shouldRepBumpInsteadOfWeight(fromLb: number, stepPct: number): boolean {
  if (fromLb <= 0) return false;
  const toLb = nextWeightAfterStepPercent(fromLb, stepPct);
  return toLb <= fromLb;
}

export function ensureTrainingProgramTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_member_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_for_sale INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER,
      published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_programs_creator ON training_programs(creator_member_id);

    CREATE TABLE IF NOT EXISTS training_program_workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL,
      day_index INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      training_phase TEXT NOT NULL DEFAULT 'HYPERTROPHY',
      template_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (program_id) REFERENCES training_programs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_training_program_workouts_program_day ON training_program_workouts(program_id, day_index);

    CREATE TABLE IF NOT EXISTS training_program_progression_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_workout_id INTEGER NOT NULL,
      exercise_key TEXT NOT NULL,
      exercise_id INTEGER,
      training_phase TEXT NOT NULL,
      target_reps_min INTEGER,
      target_reps_max INTEGER,
      starting_weight_lb REAL,
      step_percent REAL,
      UNIQUE(program_workout_id, exercise_key, training_phase),
      FOREIGN KEY (program_workout_id) REFERENCES training_program_workouts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS member_program_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL,
      member_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('assigned', 'purchase')),
      assigned_by_member_id TEXT,
      starts_on TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (program_id) REFERENCES training_programs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_member_program_assignments_member ON member_program_assignments(member_id);

    CREATE TABLE IF NOT EXISTS member_program_lift_progress (
      assignment_id INTEGER NOT NULL,
      exercise_key TEXT NOT NULL,
      training_phase TEXT NOT NULL,
      current_weight_lb REAL NOT NULL,
      extra_reps_per_set INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (assignment_id, exercise_key, training_phase),
      FOREIGN KEY (assignment_id) REFERENCES member_program_assignments(id) ON DELETE CASCADE
    );
  `);

  const liftProgCols = db.prepare("PRAGMA table_info(member_program_lift_progress)").all() as { name: string }[];
  if (liftProgCols.length > 0 && liftProgCols.every((c) => c.name !== "extra_reps_per_set")) {
    try {
      db.prepare("ALTER TABLE member_program_lift_progress ADD COLUMN extra_reps_per_set INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      /* ignore */
    }
  }

  const workoutCols = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  for (const col of ["program_assignment_id", "program_workout_id", "program_title"]) {
    if (workoutCols.every((c) => c.name !== col)) {
      try {
        db.prepare(`ALTER TABLE workouts ADD COLUMN ${col === "program_assignment_id" || col === "program_workout_id" ? col + " INTEGER" : col + " TEXT"}`).run();
      } catch {
        /* ignore */
      }
    }
  }
}

export function parseProgramTemplateJson(raw: string | null): TrainerAssignedExercisePayload[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TrainerAssignedExercisePayload[]) : [];
  } catch {
    return [];
  }
}

/** After a finished program workout: bump weights when all prescribed sets hit rep range. */
export function applyProgramProgressionAfterFinish(
  db: Database.Database,
  workoutId: number,
  memberId: string
): {
  bumps: { exercise_key: string; phase: TrainingPhase; from_lb: number; to_lb: number }[];
  rep_bumps: { exercise_key: string; phase: TrainingPhase; added_reps: number; total_extra_reps: number }[];
} {
  const w = db
    .prepare(
      "SELECT program_assignment_id, program_workout_id FROM workouts WHERE id = ? AND member_id = ? AND finished_at IS NOT NULL"
    )
    .get(workoutId, memberId) as { program_assignment_id: number | null; program_workout_id: number | null } | undefined;
  if (!w?.program_assignment_id || !w?.program_workout_id) return { bumps: [], rep_bumps: [] };

  const rules = db
    .prepare(
      `SELECT exercise_key, exercise_id, training_phase, target_reps_min, target_reps_max, step_percent, starting_weight_lb
       FROM training_program_progression_rules WHERE program_workout_id = ?`
    )
    .all(w.program_workout_id) as {
    exercise_key: string;
    exercise_id: number | null;
    training_phase: string;
    target_reps_min: number | null;
    target_reps_max: number | null;
    step_percent: number | null;
    starting_weight_lb: number | null;
  }[];

  if (rules.length === 0) return { bumps: [], rep_bumps: [] };

  const pw = db
    .prepare("SELECT training_phase FROM training_program_workouts WHERE id = ?")
    .get(w.program_workout_id) as { training_phase: string } | undefined;
  const workoutPhase = parseTrainingPhase(pw?.training_phase);

  const sets = db
    .prepare(
      `SELECT we.exercise_id, we.exercise_name, ws.reps, ws.weight_kg AS weight_lb
       FROM workout_exercises we
       JOIN workout_sets ws ON ws.workout_exercise_id = we.id
       WHERE we.workout_id = ? AND we.type = 'lift'`
    )
    .all(workoutId) as { exercise_id: number | null; exercise_name: string; reps: number | null; weight_lb: number | null }[];

  const bumps: { exercise_key: string; phase: TrainingPhase; from_lb: number; to_lb: number }[] = [];
  const rep_bumps: { exercise_key: string; phase: TrainingPhase; added_reps: number; total_extra_reps: number }[] = [];

  const upsertProgress = db.prepare(
    `INSERT INTO member_program_lift_progress (assignment_id, exercise_key, training_phase, current_weight_lb, extra_reps_per_set, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(assignment_id, exercise_key, training_phase) DO UPDATE SET
       current_weight_lb = excluded.current_weight_lb,
       extra_reps_per_set = excluded.extra_reps_per_set,
       updated_at = datetime('now')`
  );

  for (const rule of rules) {
    const phase = parseTrainingPhase(rule.training_phase);
    if (phase !== workoutPhase) continue;

    const key = rule.exercise_key.trim().toLowerCase();
    const minR = rule.target_reps_min ?? 0;
    const maxR = rule.target_reps_max ?? 999;
    if (minR <= 0) continue;

    const matching = sets.filter((s) => {
      const nameKey = s.exercise_name.trim().toLowerCase();
      if (nameKey === key) return true;
      if (rule.exercise_id != null && s.exercise_id === rule.exercise_id) return true;
      return false;
    });
    if (matching.length === 0) continue;

    const progress = db
      .prepare(
        "SELECT current_weight_lb, extra_reps_per_set FROM member_program_lift_progress WHERE assignment_id = ? AND exercise_key = ? AND training_phase = ?"
      )
      .get(w.program_assignment_id, key, phase) as { current_weight_lb: number; extra_reps_per_set: number } | undefined;

    const extraAtStart = progress?.extra_reps_per_set ?? 0;
    const adjMin = minR + extraAtStart;
    const adjMax = maxR + extraAtStart;

    const allHitAdjusted = matching.every((s) => {
      const reps = s.reps ?? 0;
      const wlb = s.weight_lb ?? 0;
      return reps >= adjMin && reps <= adjMax && wlb > 0;
    });
    if (!allHitAdjusted) continue;

    const fromLb =
      progress?.current_weight_lb ??
      rule.starting_weight_lb ??
      Math.max(...matching.map((s) => s.weight_lb ?? 0));

    /** Trainer sets % on the rule; defaults only when they haven't configured one yet. */
    const stepPct = rule.step_percent ?? DEFAULT_PHASE_STEP_PERCENT[phase];
    const toLb = nextWeightAfterStepPercent(fromLb, stepPct);

    if (shouldRepBumpInsteadOfWeight(fromLb, stepPct)) {
      const totalExtra = extraAtStart + REP_BUMP_WHEN_WEIGHT_FLAT;
      upsertProgress.run(w.program_assignment_id, key, phase, fromLb, totalExtra);
      rep_bumps.push({
        exercise_key: key,
        phase,
        added_reps: REP_BUMP_WHEN_WEIGHT_FLAT,
        total_extra_reps: totalExtra,
      });
      continue;
    }

    upsertProgress.run(w.program_assignment_id, key, phase, toLb, 0);
    bumps.push({ exercise_key: key, phase, from_lb: fromLb, to_lb: toLb });
  }

  return { bumps, rep_bumps };
}

/** Apply member progression (weight + extra reps) onto template exercises when starting a program workout. */
export function mergeProgramProgressIntoExercises(
  exercises: TrainerAssignedExercisePayload[],
  progressRows: { exercise_key: string; current_weight_lb: number; extra_reps_per_set: number }[],
  rules: { exercise_key: string; starting_weight_lb: number | null }[]
): TrainerAssignedExercisePayload[] {
  const weightMap = new Map(progressRows.map((r) => [r.exercise_key, r.current_weight_lb]));
  const repsMap = new Map(progressRows.map((r) => [r.exercise_key, r.extra_reps_per_set ?? 0]));

  return exercises.map((ex) => {
    const key = ex.exercise_name.trim().toLowerCase();
    const rule = rules.find((r) => r.exercise_key === key);
    const targetLb = weightMap.get(key) ?? rule?.starting_weight_lb ?? null;
    const extraReps = repsMap.get(key) ?? 0;
    if ((targetLb == null || targetLb <= 0) && extraReps <= 0) return ex;
    if (!ex.sets?.length) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s) => {
        if (!("reps" in s) && !("weight_kg" in s)) return s;
        const row = s as { reps?: number; weight_kg?: number; notes?: string };
        const hasWeight = row.weight_kg != null && row.weight_kg > 0;
        const baseReps = row.reps != null && Number.isFinite(row.reps) ? row.reps : 0;
        return {
          ...row,
          weight_kg: hasWeight ? row.weight_kg : targetLb ?? row.weight_kg,
          reps: extraReps > 0 ? Math.max(1, baseReps + extraReps) : row.reps,
        };
      }),
    };
  });
}