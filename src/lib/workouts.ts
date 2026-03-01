/**
 * Schema and helpers for member workouts (lifting + cardio tracking).
 */

import { getDb } from "./db";

export function ensureWorkoutTables(db: ReturnType<typeof getDb>) {
  // Migrate workouts if it was created with invalid FK (members PK is id, not member_id)
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workouts'").get() as { sql: string } | undefined;
    if (tableInfo?.sql?.includes("REFERENCES members")) {
      db.exec(`
        CREATE TABLE workouts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        INSERT INTO workouts_new (id, member_id, started_at, finished_at) SELECT id, member_id, started_at, finished_at FROM workouts;
        DROP TABLE IF EXISTS workout_sets;
        DROP TABLE IF EXISTS workout_exercises;
        DROP TABLE workouts;
        ALTER TABLE workouts_new RENAME TO workouts;
      `);
    }
  } catch {
    /* ignore */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      source_workout_id INTEGER
    );
  `);
  const columns = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  if (columns.every((c) => c.name !== "source_workout_id")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN source_workout_id INTEGER").run();
    } catch {
      /* ignore */
    }
  }
  if (columns.every((c) => c.name !== "name")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN name TEXT").run();
    } catch {
      /* ignore */
    }
  }
  if (columns.every((c) => c.name !== "assigned_by_admin")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN assigned_by_admin INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      /* ignore */
    }
  }
  const colsAfterAdmin = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  if (colsAfterAdmin.every((c) => c.name !== "assigned_by_trainer_member_id")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN assigned_by_trainer_member_id TEXT").run();
    } catch {
      /* ignore */
    }
  }
  const colsAfterTrainer = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  if (colsAfterTrainer.every((c) => c.name !== "trainer_notes")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN trainer_notes TEXT").run();
    } catch {
      /* ignore */
    }
  }
  const colsAfterTrainerNotes = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  if (colsAfterTrainerNotes.every((c) => c.name !== "client_completion_notes")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN client_completion_notes TEXT").run();
    } catch {
      /* ignore */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('lift', 'cardio')),
      primary_muscles TEXT,
      secondary_muscles TEXT,
      equipment TEXT,
      muscle_group TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_name_type ON exercises(name, type);
    CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
  `);
  const exerciseCols = db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];
  for (const col of ["primary_muscles", "secondary_muscles", "equipment", "muscle_group", "instructions"]) {
    if (exerciseCols.every((c) => c.name !== col)) {
      try {
        db.prepare(`ALTER TABLE exercises ADD COLUMN ${col} TEXT`).run();
      } catch {
        /* ignore */
      }
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('lift', 'cardio')),
      exercise_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workout_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_exercise_id INTEGER NOT NULL,
      reps INTEGER,
      weight_kg REAL,
      time_seconds INTEGER,
      distance_km REAL,
      set_order INTEGER NOT NULL DEFAULT 0,
      drop_index INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_member ON workouts(member_id);
    CREATE INDEX IF NOT EXISTS idx_workouts_finished ON workouts(member_id, finished_at);
    CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_id);
    CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(workout_exercise_id);
  `);

  const exCols = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
  if (exCols.every((c) => c.name !== "exercise_id")) {
    try {
      db.prepare("ALTER TABLE workout_exercises ADD COLUMN exercise_id INTEGER REFERENCES exercises(id)").run();
    } catch {
      /* ignore */
    }
  }
  try {
    db.prepare("CREATE INDEX IF NOT EXISTS idx_workout_exercises_exercise ON workout_exercises(exercise_id)").run();
  } catch {
    /* ignore if column still missing in edge cases */
  }

  const setCols = db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[];
  if (setCols.every((c) => c.name !== "drop_index")) {
    try {
      db.prepare("ALTER TABLE workout_sets ADD COLUMN drop_index INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      /* ignore */
    }
  }
}
