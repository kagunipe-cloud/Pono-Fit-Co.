/**
 * Expand trainer availability to dates and compute free intervals / bookable start times.
 */

import { getDb } from "./db";
import { ensurePTSlotTables, timeToMinutes, minutesToTime, reservedMinutes, RESERVE_MINUTES } from "./pt-slots";

export type FreeInterval = { startMin: number; endMin: number };

export function getBlocksInRange(from: string, to: string): { id: number; trainer: string; trainer_member_id?: string | null; date: string; start_time: string; end_time: string; description?: string | null }[] {
  const db = getDb();
  ensurePTSlotTables(db);
  const rows = db.prepare("SELECT id, trainer, trainer_member_id, day_of_week, start_time, end_time, description, days_of_week FROM trainer_availability").all() as {
    id: number;
    trainer: string;
    trainer_member_id?: string | null;
    day_of_week: number;
    start_time: string;
    end_time: string;
    description?: string | null;
    days_of_week?: string | null;
  }[];
  db.close();

  const fromDate = new Date(from + "T12:00:00");
  const toDate = new Date(to + "T12:00:00");
  const blocks: { id: number; trainer: string; trainer_member_id?: string | null; date: string; start_time: string; end_time: string; description?: string | null }[] = [];
  const cur = new Date(fromDate);
  while (cur <= toDate) {
    const dateStr = cur.toISOString().slice(0, 10);
    const day = cur.getDay();
    for (const r of rows) {
      const daysMatch = (() => {
        const dow = (r as { days_of_week?: string | null }).days_of_week;
        if (dow != null && String(dow).trim() !== "") {
          const days = String(dow).split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => d >= 0 && d <= 6);
          return days.length > 0 ? days.includes(day) : r.day_of_week === day;
        }
        return r.day_of_week === day;
      })();
      if (daysMatch) {
        blocks.push({
          id: r.id,
          trainer: r.trainer,
          trainer_member_id: r.trainer_member_id ?? null,
          date: dateStr,
          start_time: r.start_time,
          end_time: r.end_time,
          description: (r as { description?: string | null }).description ?? null,
        });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return blocks;
}

export type UnavailableOccurrence = { id: number; trainer: string; date: string; start_time: string; end_time: string; description: string };

/** Expand unavailable_blocks to date range. trainer '' means facility-wide. */
export function getUnavailableInRange(from: string, to: string): UnavailableOccurrence[] {
  const db = getDb();
  ensurePTSlotTables(db);
  const rows = db.prepare("SELECT id, trainer, day_of_week, start_time, end_time, description FROM unavailable_blocks").all() as {
    id: number;
    trainer: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    description: string;
  }[];
  db.close();
  const fromDate = new Date(from + "T12:00:00");
  const toDate = new Date(to + "T12:00:00");
  const out: UnavailableOccurrence[] = [];
  const cur = new Date(fromDate);
  while (cur <= toDate) {
    const dateStr = cur.toISOString().slice(0, 10);
    const day = cur.getDay();
    for (const r of rows) {
      if (r.day_of_week === day) {
        out.push({
          id: r.id,
          trainer: r.trainer ?? "",
          date: dateStr,
          start_time: r.start_time,
          end_time: r.end_time,
          description: r.description ?? "",
        });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function getBookingsForBlock(db: ReturnType<typeof getDb>, trainer_availability_id: number, occurrence_date: string): { start_time: string; reserved_minutes: number }[] {
  const rows = db.prepare(
    "SELECT start_time, reserved_minutes FROM pt_block_bookings WHERE trainer_availability_id = ? AND occurrence_date = ? ORDER BY start_time"
  ).all(trainer_availability_id, occurrence_date) as { start_time: string; reserved_minutes: number }[];
  return rows;
}

/** Get free intervals in a block (in minutes from midnight). Optionally merge in unavailable ranges (e.g. { startMin, endMin }[]). */
export function getFreeIntervals(
  blockStartMin: number,
  blockEndMin: number,
  bookings: { start_time: string; reserved_minutes: number }[],
  unavailableRanges?: FreeInterval[]
): FreeInterval[] {
  const reserved: FreeInterval[] = bookings.map((b) => {
    const start = timeToMinutes(b.start_time);
    return { startMin: start, endMin: start + b.reserved_minutes };
  });
  if (unavailableRanges?.length) {
    for (const u of unavailableRanges) {
      if (u.endMin > blockStartMin && u.startMin < blockEndMin) {
        reserved.push({
          startMin: Math.max(u.startMin, blockStartMin),
          endMin: Math.min(u.endMin, blockEndMin),
        });
      }
    }
  }
  reserved.sort((a, b) => a.startMin - b.startMin);
  const free: FreeInterval[] = [];
  let pos = blockStartMin;
  for (const r of reserved) {
    if (r.startMin > pos) free.push({ startMin: pos, endMin: r.startMin });
    if (r.endMin > pos) pos = r.endMin;
  }
  if (pos < blockEndMin) free.push({ startMin: pos, endMin: blockEndMin });
  return free;
}

/** For a free interval and duration, return list of start minutes that are bookable (reserve 45/75/120 or exact if only that much left). */
export function getBookableStartsInInterval(intervalStart: number, intervalEnd: number, durationMin: number): number[] {
  const need = RESERVE_MINUTES[durationMin] ?? durationMin;
  const span = intervalEnd - intervalStart;
  if (span < durationMin) return [];
  const starts: number[] = [];
  let t = intervalStart;
  while (t + need <= intervalEnd) {
    starts.push(t);
    t += need;
  }
  const remaining = intervalEnd - t;
  if (remaining === durationMin) starts.push(t);
  return starts;
}

/** Segment of a block: free (AVAILABLE), booked (with member_name), or unavailable (with description). */
export type BlockSegment = { start_time: string; end_time: string; booked: boolean; member_name?: string; trainer: string; unavailable?: boolean; description?: string };

/** Unavailable ranges overlapping a block (trainer must match or unavailable.trainer is ''). In minutes. */
export function getUnavailableRangesForBlock(
  block: { trainer: string; start_time: string; end_time: string },
  occurrence_date: string,
  unavailableOccurrences: UnavailableOccurrence[]
): FreeInterval[] {
  const blockStart = timeToMinutes(block.start_time);
  const blockEnd = timeToMinutes(block.end_time);
  const out: FreeInterval[] = [];
  for (const u of unavailableOccurrences) {
    if (u.date !== occurrence_date) continue;
    if (u.trainer !== "" && u.trainer !== block.trainer) continue;
    const startMin = timeToMinutes(u.start_time);
    const endMin = timeToMinutes(u.end_time);
    if (endMin > blockStart && startMin < blockEnd) {
      out.push({ startMin: Math.max(startMin, blockStart), endMin: Math.min(endMin, blockEnd) });
    }
  }
  return out;
}

/** Get ordered segments (free + booked + unavailable) for a block on a date. */
export function getBlockSegments(
  db: ReturnType<typeof getDb>,
  block: { id: number; trainer: string; start_time: string; end_time: string; description?: string | null },
  occurrence_date: string,
  unavailableOccurrences: UnavailableOccurrence[] = []
): BlockSegment[] {
  const blockStart = timeToMinutes(block.start_time);
  const blockEnd = timeToMinutes(block.end_time);
  const blockDesc = block.description ?? undefined;
  const bookingRows = db.prepare(
    `SELECT b.start_time, b.reserved_minutes, b.member_id, m.first_name, m.last_name
     FROM pt_block_bookings b LEFT JOIN members m ON m.member_id = b.member_id
     WHERE b.trainer_availability_id = ? AND b.occurrence_date = ? ORDER BY b.start_time`
  ).all(block.id, occurrence_date) as { start_time: string; reserved_minutes: number; member_id: string; first_name: string | null; last_name: string | null }[];
  const bookings = bookingRows.map((b) => ({ start_time: b.start_time, reserved_minutes: b.reserved_minutes }));
  const unavailRanges = getUnavailableRangesForBlock(block, occurrence_date, unavailableOccurrences);
  const free = getFreeIntervals(blockStart, blockEnd, bookings, unavailRanges);
  const segments: BlockSegment[] = [];
  for (const f of free) {
    segments.push({ start_time: minutesToTime(f.startMin), end_time: minutesToTime(f.endMin), booked: false, trainer: block.trainer, ...(blockDesc && { description: blockDesc }) });
  }
  for (const b of bookingRows) {
    const startMin = timeToMinutes(b.start_time);
    const endMin = startMin + b.reserved_minutes;
    const member_name = [b.first_name, b.last_name].filter(Boolean).join(" ").trim() || b.member_id;
    segments.push({ start_time: minutesToTime(startMin), end_time: minutesToTime(endMin), booked: true, member_name, trainer: block.trainer, ...(blockDesc && { description: blockDesc }) });
  }
  for (const u of unavailableOccurrences) {
    if (u.date !== occurrence_date) continue;
    if (u.trainer !== "" && u.trainer !== block.trainer) continue;
    const startMin = timeToMinutes(u.start_time);
    const endMin = timeToMinutes(u.end_time);
    if (endMin > blockStart && startMin < blockEnd) {
      const startMinC = Math.max(startMin, blockStart);
      const endMinC = Math.min(endMin, blockEnd);
      segments.push({
        start_time: minutesToTime(startMinC),
        end_time: minutesToTime(endMinC),
        booked: true,
        trainer: block.trainer,
        unavailable: true,
        description: u.description,
      });
    }
  }
  segments.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  return segments;
}

/** All bookable start times (as "HH:mm") for a block on a date for a given duration. Excludes unavailable. */
export function getBookableStartTimes(
  db: ReturnType<typeof getDb>,
  trainer_availability_id: number,
  occurrence_date: string,
  start_time: string,
  end_time: string,
  durationMin: number,
  unavailableRanges?: FreeInterval[]
): string[] {
  const bookings = getBookingsForBlock(db, trainer_availability_id, occurrence_date);
  const blockStart = timeToMinutes(start_time);
  const blockEnd = timeToMinutes(end_time);
  const free = getFreeIntervals(blockStart, blockEnd, bookings, unavailableRanges);
  const allStarts: number[] = [];
  for (const iv of free) {
    const starts = getBookableStartsInInterval(iv.startMin, iv.endMin, durationMin);
    allStarts.push(...starts);
  }
  allStarts.sort((a, b) => a - b);
  return [...new Set(allStarts)].map((m) => minutesToTime(m));
}
