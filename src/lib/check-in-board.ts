import type { getDb } from "./db";
import {
  boardWeekBounds,
  dateStringInAppTz,
  endOfDayInTz,
  startOfDayInTz,
  todayInAppTz,
} from "./app-timezone";
import { ensureUsageTables } from "./usage";

type Db = ReturnType<typeof getDb>;

type DoorCheckInRow = {
  member_id: string | null;
  happened_at: string;
  first_name: string | null;
  last_name: string | null;
};

export type CheckInBoardRow = {
  rank: number;
  member_id: string;
  display_name: string;
  days_logged: number;
};

export type CheckInBoardPayload = {
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
  rows: CheckInBoardRow[];
};

function displayName(row: Pick<DoorCheckInRow, "member_id" | "first_name" | "last_name">): string {
  const first = row.first_name?.trim();
  if (first) return first;
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || String(row.member_id ?? "").trim();
}

function toSqliteCompare(iso: string): string {
  return iso.trim().replace("T", " ").slice(0, 19);
}

/** Current-week leaderboard by unique local check-in days. Max one successful door check-in per member per day. */
export function buildCheckInBoard(db: Db, tz: string, weekStart?: string, today?: string): CheckInBoardPayload {
  ensureUsageTables(db);

  const todayYmd = today ?? todayInAppTz(tz);
  const bounds = weekStart
    ? { weekStart, weekEnd: todayYmd }
    : boardWeekBounds(tz, todayYmd);
  const start = bounds.weekStart;
  const end = todayYmd < bounds.weekEnd ? todayYmd : bounds.weekEnd;
  const since = toSqliteCompare(startOfDayInTz(start, tz));
  const until = toSqliteCompare(endOfDayInTz(end, tz));
  const happenedNorm = `substr(replace(replace(d.happened_at, 'T', ' '), 'Z', ''), 1, 19)`;

  const rows = db
    .prepare(
      `SELECT d.member_id, d.happened_at, m.first_name, m.last_name
       FROM door_access_events d
       LEFT JOIN members m ON m.member_id = d.member_id
       WHERE d.success = 1
         AND TRIM(IFNULL(d.member_id, '')) != ''
         AND ${happenedNorm} >= ?
         AND ${happenedNorm} <= ?
       ORDER BY d.happened_at ASC`
    )
    .all(since, until) as DoorCheckInRow[];

  const daysByMember = new Map<string, Set<string>>();
  const memberInfo = new Map<string, DoorCheckInRow>();

  for (const row of rows) {
    const memberId = String(row.member_id ?? "").trim();
    if (!memberId) continue;
    const ymd = dateStringInAppTz(row.happened_at, tz);
    if (!ymd || ymd < start || ymd > end) continue;
    const days = daysByMember.get(memberId) ?? new Set<string>();
    days.add(ymd);
    daysByMember.set(memberId, days);
    if (!memberInfo.has(memberId)) memberInfo.set(memberId, row);
  }

  const ranked = Array.from(daysByMember.entries())
    .map(([memberId, days]) => {
      const info = memberInfo.get(memberId);
      return {
        rank: 0,
        member_id: memberId,
        display_name: info ? displayName(info) : memberId,
        days_logged: days.size,
      };
    })
    .filter((row) => row.days_logged > 0)
    .sort((a, b) => {
      if (b.days_logged !== a.days_logged) return b.days_logged - a.days_logged;
      return a.display_name.localeCompare(b.display_name);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    timezone: tz,
    today: todayYmd,
    week_start: start,
    week_end: end,
    rows: ranked,
  };
}
