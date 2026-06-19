import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

export const GYM_RECORD_AGE_BRACKETS = ["18-39", "40-49", "50-59", "60-69", "70+"] as const;
export type GymRecordAgeBracket = (typeof GYM_RECORD_AGE_BRACKETS)[number];

export const GYM_RECORD_GENDERS = ["men", "women"] as const;
export type GymRecordGender = (typeof GYM_RECORD_GENDERS)[number];

export const GYM_RECORD_PLACES = [1, 2, 3] as const;
export type GymRecordPlace = (typeof GYM_RECORD_PLACES)[number];

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

/** Portrait TV: men/women side-by-side → 2 age groups page 1, 3 on page 2. */
export const GYM_RECORD_TV_PAGES: readonly (readonly GymRecordAgeBracket[])[] = [
  ["18-39", "40-49"],
  ["50-59", "60-69", "70+"],
] as const;

export type GymRecordPlaceCell = {
  holder_name: string;
  record_value: string;
};

export type GymRecordCell = {
  age_bracket: GymRecordAgeBracket;
  gender: GymRecordGender;
  event_key: GymRecordEventKey;
  place: GymRecordPlace;
  holder_name: string;
  record_value: string;
};

export type GymRecordsGrid = Record<
  GymRecordAgeBracket,
  Record<GymRecordGender, Record<GymRecordEventKey, GymRecordPlaceCell[]>>
>;

function emptyPlaceCell(): GymRecordPlaceCell {
  return { holder_name: "", record_value: "" };
}

function emptyEventPlaces(): GymRecordPlaceCell[] {
  return [emptyPlaceCell(), emptyPlaceCell(), emptyPlaceCell()];
}

export function emptyGymRecordsGrid(): GymRecordsGrid {
  const grid = {} as GymRecordsGrid;
  for (const age of GYM_RECORD_AGE_BRACKETS) {
    grid[age] = {
      men: {} as Record<GymRecordEventKey, GymRecordPlaceCell[]>,
      women: {} as Record<GymRecordEventKey, GymRecordPlaceCell[]>,
    };
    for (const gender of GYM_RECORD_GENDERS) {
      for (const ev of GYM_RECORD_EVENTS) {
        grid[age][gender][ev.key] = emptyEventPlaces();
      }
    }
  }
  return grid;
}

function placeToIndex(place: number): number {
  return Math.min(2, Math.max(0, place - 1));
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

  const cols = db.prepare("PRAGMA table_info(gym_records)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "place")) {
    db.exec(`
      CREATE TABLE gym_records_v2 (
        age_bracket TEXT NOT NULL,
        gender TEXT NOT NULL,
        event_key TEXT NOT NULL,
        place INTEGER NOT NULL DEFAULT 1,
        holder_name TEXT NOT NULL DEFAULT '',
        record_value TEXT NOT NULL DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (age_bracket, gender, event_key, place)
      );
      INSERT INTO gym_records_v2 (age_bracket, gender, event_key, place, holder_name, record_value, updated_at)
        SELECT age_bracket, gender, event_key, 1, holder_name, record_value, updated_at
        FROM gym_records;
      DROP TABLE gym_records;
      ALTER TABLE gym_records_v2 RENAME TO gym_records;
    `);
  }
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

function isPlace(v: number): v is GymRecordPlace {
  return v === 1 || v === 2 || v === 3;
}

export function getGymRecordsGrid(db: Db): GymRecordsGrid {
  ensureGymRecordsTable(db);
  const grid = emptyGymRecordsGrid();
  const rows = db
    .prepare(
      `SELECT age_bracket, gender, event_key, place, holder_name, record_value
       FROM gym_records`
    )
    .all() as {
      age_bracket: string;
      gender: string;
      event_key: string;
      place: number;
      holder_name: string | null;
      record_value: string | null;
    }[];

  for (const row of rows) {
    const age = String(row.age_bracket ?? "");
    const gender = String(row.gender ?? "");
    const eventKey = String(row.event_key ?? "");
    const place = Number(row.place) || 1;
    if (!isAgeBracket(age) || !isGender(gender) || !isEventKey(eventKey) || !isPlace(place)) continue;
    grid[age][gender][eventKey][placeToIndex(place)] = {
      holder_name: String(row.holder_name ?? "").trim(),
      record_value: String(row.record_value ?? "").trim(),
    };
  }
  return grid;
}

export function saveGymRecords(db: Db, cells: GymRecordCell[]): void {
  ensureGymRecordsTable(db);
  const upsert = db.prepare(
    `INSERT INTO gym_records (age_bracket, gender, event_key, place, holder_name, record_value, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(age_bracket, gender, event_key, place) DO UPDATE SET
       holder_name = excluded.holder_name,
       record_value = excluded.record_value,
       updated_at = datetime('now')`
  );
  const tx = db.transaction((items: GymRecordCell[]) => {
    for (const cell of items) {
      if (
        !isAgeBracket(cell.age_bracket) ||
        !isGender(cell.gender) ||
        !isEventKey(cell.event_key) ||
        !isPlace(cell.place)
      ) {
        throw new Error("Invalid gym record cell.");
      }
      upsert.run(
        cell.age_bracket,
        cell.gender,
        cell.event_key,
        cell.place,
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
        const places = grid[age][gender][ev.key];
        for (let i = 0; i < GYM_RECORD_PLACES.length; i++) {
          const place = GYM_RECORD_PLACES[i]!;
          const cell = places[i] ?? emptyPlaceCell();
          out.push({
            age_bracket: age,
            gender,
            event_key: ev.key,
            place,
            holder_name: cell.holder_name,
            record_value: cell.record_value,
          });
        }
      }
    }
  }
  return out;
}

export function formatGymRecordLine(name: string, value: string): string {
  const n = name.trim();
  const v = value.trim();
  if (!n && !v) return "—";
  if (!n) return v;
  if (!v) return n;
  return `${n} - ${v}`;
}
