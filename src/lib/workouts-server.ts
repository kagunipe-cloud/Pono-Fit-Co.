import "server-only";

import fs from "fs";
import type { Database } from "better-sqlite3";
import { DATABASE_FILE_PATH } from "./database-path";

type AppDb = Database;

const EXERCISE_TYPE_BACKUP_SUFFIX = "_old_type_constraint";
/** Intermediate name for copy-out CHECK migration (avoids rename-to-backup races). */
const STRETCH_REBUILD_SUFFIX = "__stretch_rebuild_tmp";

const WORKOUT_TYPE_MIGRATE_LOCK = `${DATABASE_FILE_PATH}.workout-type-migrate.lock`;
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_SPIN_MS = 25;
const LOCK_WAIT_MAX_MS = 120 * 1000;

function spinWait(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy-wait; rare (only during stretch CHECK migration contention) */
  }
}

function withExclusiveWorkoutTypeMigrateLock<T>(fn: () => T): T {
  try {
    const st = fs.statSync(WORKOUT_TYPE_MIGRATE_LOCK);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      try {
        fs.unlinkSync(WORKOUT_TYPE_MIGRATE_LOCK);
      } catch {
        /* another host cleared it */
      }
    }
  } catch {
    /* no lock file */
  }

  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  let lockFd: number | undefined;
  while (Date.now() < deadline) {
    try {
      lockFd = fs.openSync(WORKOUT_TYPE_MIGRATE_LOCK, "wx");
      fs.writeSync(lockFd, `${process.pid}\n`);
      break;
    } catch {
      spinWait(LOCK_SPIN_MS);
    }
  }
  if (lockFd === undefined) {
    throw new Error("[workouts] workout type migration lock timeout after " + LOCK_WAIT_MAX_MS + "ms");
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(WORKOUT_TYPE_MIGRATE_LOCK);
    } catch {
      /* ignore */
    }
  }
}

function repairOrphanExerciseTypeBackupTable(db: AppDb, table: "exercises" | "workout_exercises"): void {
  const tempTable = `${table}${EXERCISE_TYPE_BACKUP_SUFFIX}`;
  const temp = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tempTable) as { name: string } | undefined;
  if (!temp) return;

  const main = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    if (!main) {
      db.prepare(`ALTER TABLE "${tempTable}" RENAME TO "${table}"`).run();
      return;
    }
    const mainCount = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    if (!mainCount.n) {
      db.prepare(`DROP TABLE "${table}"`).run();
      db.prepare(`ALTER TABLE "${tempTable}" RENAME TO "${table}"`).run();
      return;
    }
    const tempCount = db.prepare(`SELECT COUNT(*) AS n FROM "${tempTable}"`).get() as { n: number };
    if (tempCount.n === 0) {
      db.prepare(`DROP TABLE "${tempTable}"`).run();
    } else {
      console.warn(
        `[workouts] Both "${table}" and "${tempTable}" have rows; dropping backup (${tempCount.n} rows). If data looks wrong, restore from backup DB.`
      );
      db.prepare(`DROP TABLE "${tempTable}"`).run();
    }
  } catch (err) {
    console.error(`[workouts] repairOrphanExerciseTypeBackupTable(${table})`, err);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function dropOrphanStretchRebuildTable(db: AppDb, table: "exercises" | "workout_exercises"): void {
  try {
    db.prepare(`DROP TABLE IF EXISTS "${table}${STRETCH_REBUILD_SUFFIX}"`).run();
  } catch {
    /* ignore */
  }
}

function migrateExerciseTypeConstraint(db: AppDb, table: "exercises" | "workout_exercises"): void {
  withExclusiveWorkoutTypeMigrateLock(() => {
    repairOrphanExerciseTypeBackupTable(db, table);
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql?: string } | undefined;
    if (!row?.sql || row.sql.includes("'stretch'")) {
      repairOrphanExerciseTypeBackupTable(db, table);
      dropOrphanStretchRebuildTable(db, table);
      return;
    }

    const legacyBackup = `${table}${EXERCISE_TYPE_BACKUP_SUFFIX}`;
    const rebuild = `${table}${STRETCH_REBUILD_SUFFIX}`;

    // Copy live table → new schema → swap. Source keeps its real name until DROP, so nothing
    // references *_old_type_constraint during the migration (eliminates that failure mode).
    const job = db.transaction(() => {
      db.prepare(`DROP TABLE IF EXISTS "${rebuild}"`).run();

      const srcCols = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
      const has = (n: string) => srcCols.some((c) => c.name === n);

      if (table === "exercises") {
        db.exec(`
          CREATE TABLE "${rebuild}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('lift', 'cardio', 'stretch')),
            primary_muscles TEXT,
            secondary_muscles TEXT,
            equipment TEXT,
            muscle_group TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            instructions TEXT,
            image_path TEXT
          );
        `);
        const dest = [
          "id",
          "name",
          "type",
          "primary_muscles",
          "secondary_muscles",
          "equipment",
          "muscle_group",
          "created_at",
          "instructions",
          "image_path",
        ] as const;
        const selectSql = dest
          .map((c) => {
            if (has(c)) return c;
            if (c === "created_at") return `datetime('now')`;
            return "NULL";
          })
          .join(", ");
        db.exec(`INSERT INTO "${rebuild}" (${dest.join(", ")}) SELECT ${selectSql} FROM "${table}"`);
      } else {
        db.exec(`
          CREATE TABLE "${rebuild}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('lift', 'cardio', 'stretch')),
            exercise_name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            exercise_id INTEGER REFERENCES exercises(id),
            use_for_my_1rm INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
          );
        `);
        const dest = [
          "id",
          "workout_id",
          "type",
          "exercise_name",
          "sort_order",
          "exercise_id",
          "use_for_my_1rm",
        ] as const;
        const selectSql = dest
          .map((c) => {
            if (!has(c)) {
              if (c === "exercise_id") return "NULL";
              if (c === "use_for_my_1rm") return "0";
              throw new Error(`migrateExerciseTypeConstraint: "${table}" missing required column ${c}`);
            }
            if (c === "use_for_my_1rm") return "coalesce(use_for_my_1rm, 0)";
            return c;
          })
          .join(", ");
        db.exec(`INSERT INTO "${rebuild}" (${dest.join(", ")}) SELECT ${selectSql} FROM "${table}"`);
      }

      db.prepare(`DROP TABLE "${table}"`).run();
      db.prepare(`ALTER TABLE "${rebuild}" RENAME TO "${table}"`).run();
    });

    db.exec("PRAGMA foreign_keys = OFF");
    try {
      job.exclusive();
    } catch (err) {
      console.error(`[workouts] migrateExerciseTypeConstraint(${table})`, err);
      try {
        repairOrphanExerciseTypeBackupTable(db, table);
        db.exec("PRAGMA foreign_keys = OFF");
        try {
          db.prepare(`DROP TABLE IF EXISTS "${rebuild}"`).run();
          const stillLegacy =
            (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(legacyBackup) as { name?: string } | undefined) != null;
          const stillMain =
            (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined) != null;
          if (stillLegacy && !stillMain) {
            db.prepare(`ALTER TABLE "${legacyBackup}" RENAME TO "${table}"`).run();
          }
        } finally {
          db.exec("PRAGMA foreign_keys = ON");
        }
      } catch (rollbackErr) {
        console.error(`[workouts] migrateExerciseTypeConstraint rollback (${table})`, rollbackErr);
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  });
}

export function ensureWorkoutTables(db: AppDb) {
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

  repairOrphanExerciseTypeBackupTable(db, "exercises");
  repairOrphanExerciseTypeBackupTable(db, "workout_exercises");
  dropOrphanStretchRebuildTable(db, "exercises");
  dropOrphanStretchRebuildTable(db, "workout_exercises");

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
  const colsAfterClientNotes = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  if (colsAfterClientNotes.every((c) => c.name !== "shared_by_member_id")) {
    try {
      db.prepare("ALTER TABLE workouts ADD COLUMN shared_by_member_id TEXT").run();
    } catch {
      /* ignore */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('lift', 'cardio', 'stretch')),
      primary_muscles TEXT,
      secondary_muscles TEXT,
      equipment TEXT,
      muscle_group TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_name_type ON exercises(name, type);
    CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
  `);
  migrateExerciseTypeConstraint(db, "exercises");
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_name_type ON exercises(name, type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name)").run();
  const exerciseCols = db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];
  for (const col of ["primary_muscles", "secondary_muscles", "equipment", "muscle_group", "instructions", "image_path"]) {
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
      type TEXT NOT NULL CHECK (type IN ('lift', 'cardio', 'stretch')),
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
  migrateExerciseTypeConstraint(db, "workout_exercises");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_id)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(workout_exercise_id)").run();

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

  const weCols = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
  if (weCols.every((c) => c.name !== "use_for_my_1rm")) {
    try {
      db.prepare("ALTER TABLE workout_exercises ADD COLUMN use_for_my_1rm INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      /* ignore */
    }
  }

  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='member_1rm_settings'").get() as { sql?: string } | undefined;
    if (tableSql?.sql?.includes("member_id TEXT PRIMARY KEY")) {
      db.exec(`
        CREATE TABLE member_1rm_settings_new (member_id TEXT NOT NULL, exercise_id INTEGER NOT NULL, PRIMARY KEY (member_id, exercise_id));
        INSERT INTO member_1rm_settings_new (member_id, exercise_id) SELECT member_id, exercise_id FROM member_1rm_settings;
        DROP TABLE member_1rm_settings;
        ALTER TABLE member_1rm_settings_new RENAME TO member_1rm_settings;
      `);
    }
  } catch {
    /* ignore */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_1rm_settings (
      member_id TEXT NOT NULL,
      exercise_id INTEGER NOT NULL,
      PRIMARY KEY (member_id, exercise_id)
    );
    CREATE TABLE IF NOT EXISTS member_1rm_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      workout_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      estimated_1rm_lbs REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_member_1rm_records_member ON member_1rm_records(member_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_exercise_favorites (
      member_id TEXT NOT NULL,
      exercise_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (member_id, exercise_id)
    );
    CREATE INDEX IF NOT EXISTS idx_member_ex_fav_member ON member_exercise_favorites(member_id);
  `);
}
