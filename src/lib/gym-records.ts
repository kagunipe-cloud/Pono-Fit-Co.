import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

export const GYM_RECORD_AGE_BRACKETS = ["18-39", "40-49", "50-59", "60-69", "70+"] as const;
export type GymRecordAgeBracket = (typeof GYM_RECORD_AGE_BRACKETS)[number];

export const GYM_RECORD_GENDERS = ["men", "women"] as const;
export type GymRecordGender = (typeof GYM_RECORD_GENDERS)[number];

export const GYM_RECORD_EVENTS = [
  { key: "bench_press", label: "BENCH PRESS" },
  { key: "squat", label: "SQUAT" },
  { key: "deadlift", label: "DEADLIFT" },
  { key: "mile_run", label: "1 MILE RUN" },
  { key: "row_2000m", label: "2000M ROW" },
  { key: "pullups", label: "PULLUPS" },
  { key: "plank", label: "PLANK" },
  { key: "wall_sit", label: "WALL SIT" },
] as const;

export type GymRecordEventKey = (typeof GYM_RECORD_EVENTS)[number]["key"];

export type GymRecordCell = {
  age_bracket: GymRecordAgeBracket;
  gender: GymRecordGender;
  event_key: GymRecordEventKey;
  holder_name: string;
  record_value: string;
};

export type GymRecordsGrid = Record<
  GymRecordAgeBracket,
  Record<GymRecordGender, Record<GymRecordEventKey, { holder_name: string; record_value: string }>>
>;

function emptyCell(): { holder_name: string; record_value: string } {
  return { holder_name: "", record_value: "" };
}

export function emptyGymRecordsGrid(): GymRecordsGrid {
  const grid = {} as GymRecordsGrid;
  for (const age of GYM_RECORD_AGE_BRACKETS) {
    grid[age] = { men: {} as Record<GymRecordEventKey, { holder_name: string; record_value: string }>, women: {} as Record<GymRecordEventKey, { holder_name: string; record_value: string }> };
    for (const gender of GYM_RECORD_GENDERS) {
      for (const ev of GYM_RECORD_EVENTS) {
        grid[age][gender][ev.key] = emptyCell();
      }
    }
  }
  return grid;
}

export function ensureGymRecordsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gym_records (
      age_bracket TEXT NOT NULL,
      gender TEXT NOT NULL,
      event_key TEXT NOT NULL,
      holder_name TEXT NOT NULL DEFAULT '',
      record_value TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (age_bracket, gender, event_key)
    );
  `);
}

function isAgeBracket(v: string): v is GymRecordAgeBracket {
  return (GYM_RECORD_AGE_BRACKETS as readonly string[]).includes(v);
}

function isGender(v: string): v is GymRecordGender {
  return (GYM_RECORD_GENDERS as readonly string[]).includes(v);
}

function isEventKey(v: string): v is GymRecordEventKey {
  return GYM_RECORD_EVENTS.some((e) => e.key === v);
}

export function getGymRecordsGrid(db: Db): GymRecordsGrid {
  ensureGymRecordsTable(db);
  const grid = emptyGymRecordsGrid();
  const rows = db
    .prepare(
      `SELECT age_bracket, gender, event_key, holder_name, record_value
       FROM gym_records`
    )
    .all() as {
      age_bracket: string;
      gender: string;
      event_key: string;
      holder_name: string | null;
      record_value: string | null;
    }[];

  for (const row of rows) {
    const age = String(row.age_bracket ?? "");
    const gender = String(row.gender ?? "");
    const eventKey = String(row.event_key ?? "");
    if (!isAgeBracket(age) || !isGender(gender) || !isEventKey(eventKey)) continue;
    grid[age][gender][eventKey] = {
      holder_name: String(row.holder_name ?? "").trim(),
      record_value: String(row.record_value ?? "").trim(),
    };
  }
  return grid;
}

export function saveGymRecords(db: Db, cells: GymRecordCell[]): void {
  ensureGymRecordsTable(db);
  const upsert = db.prepare(
    `INSERT INTO gym_records (age_bracket, gender, event_key, holder_name, record_value, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(age_bracket, gender, event_key) DO UPDATE SET
       holder_name = excluded.holder_name,
       record_value = excluded.record_value,
       updated_at = datetime('now')`
  );
  const tx = db.transaction((items: GymRecordCell[]) => {
    for (const cell of items) {
      if (!isAgeBracket(cell.age_bracket) || !isGender(cell.gender) || !isEventKey(cell.event_key)) {
        throw new Error("Invalid gym record cell.");
      }
      upsert.run(
        cell.age_bracket,
        cell.gender,
        cell.event_key,
        String(cell.holder_name ?? "").trim(),
        String(cell.record_value ?? "").trim()
      );
    }
  });
  tx(cells);
}

export function gridToCells(grid: GymRecordsGrid): GymRecordCell[] {
  const out: GymRecordCell[] = [];
  for (const age of GYM_RECORD_AGE_BRACKETS) {
    for (const gender of GYM_RECORD_GENDERS) {
      for (const ev of GYM_RECORD_EVENTS) {
        const cell = grid[age][gender][ev.key];
        out.push({
          age_bracket: age,
          gender,
          event_key: ev.key,
          holder_name: cell.holder_name,
          record_value: cell.record_value,
        });
      }
    }
  }
  return out;
}
