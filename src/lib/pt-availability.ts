/**
 * Expand trainer availability to dates and compute free intervals / bookable start times.
 */

import { addDaysToDateStr } from "./app-timezone";
import { getDb } from "./db";
import { ensurePTSlotTables, timeToMinutes, minutesToTime, RESERVE_MINUTES } from "./pt-slots";

export type FreeInterval = { startMin: number; endMin: number };

export type ExpandedAvailabilityBlock = {
  id: number;
  trainer: string;
  trainer_member_id?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  description?: string | null;
};

/** Same trainer for chaining / filtering (strict id match, or both legacy name-only rows). */
export function blocksSameTrainer(
  a: Pick<ExpandedAvailabilityBlock, "trainer" | "trainer_member_id">,
  b: Pick<ExpandedAvailabilityBlock, "trainer" | "trainer_member_id">
): boolean {
  const idA = (a.trainer_member_id ?? "").trim();
  const idB = (b.trainer_member_id ?? "").trim();
  if (idA !== "" && idB !== "") return idA === idB;
  if (idA === "" && idB === "") return a.trainer.trim().toLowerCase() === b.trainer.trim().toLowerCase();
  return false;
}

/** Match `find-block` / PT grid: by trainer_member_id, or legacy rows with empty id and matching display name. */
export function filterBlocksForTrainerMember(allBlocks: ExpandedAvailabilityBlock[], trainer_member_id: string): ExpandedAvailabilityBlock[] {
  let matching = allBlocks.filter((b) => (b.trainer_member_id ?? "").trim() === trainer_member_id.trim());
  if (matching.length === 0) {
    const db = getDb();
    const member = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(trainer_member_id) as
      | { first_name: string | null; last_name: string | null }
      | undefined;
    db.close();
    const displayName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ").trim() : null;
    if (displayName) {
      matching = allBlocks.filter(
        (b) =>
          (b.trainer_member_id == null || String(b.trainer_member_id).trim() === "") &&
          b.trainer.trim().toLowerCase() === displayName.toLowerCase()
      );
    }
  }
  return matching;
}

/** Among blocks that contain `startMin`, return the widest span (break ties by larger end time). */
export function selectWidestBlockContaining(blocks: ExpandedAvailabilityBlock[], startMin: number): ExpandedAvailabilityBlock | null {
  const candidates = blocks.filter((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMin >= bs && startMin < be;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => {
    const spanA = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
    const spanB = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
    if (spanB !== spanA) return spanB > spanA ? b : a;
    const endA = timeToMinutes(a.end_time);
    const endB = timeToMinutes(b.end_time);
    return endB > endA ? b : a;
  });
}

/**
 * Blocks that are the same calendar row as `anchor` and share its trainer, sorted by start time.
 * Expands `anchor` into a chain where each row's end time equals the next row's start time (e.g. 7–9 and 9–21 → one 7–21 window for booking math).
 */
export function getContiguousAvailabilityChain(
  blocksOnDate: ExpandedAvailabilityBlock[],
  anchorBlockId: number
): { blockIds: number[]; mergedStartMin: number; mergedEndMin: number } | null {
  const anchor = blocksOnDate.find((b) => b.id === anchorBlockId);
  if (!anchor) return null;
  const peers = blocksOnDate.filter((b) => b.date === anchor.date && blocksSameTrainer(b, anchor));
  const sorted = [...peers]
    .map((b) => ({
      id: b.id,
      startMin: timeToMinutes(b.start_time),
      endMin: timeToMinutes(b.end_time),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id - b.id);
  const anchorIdx = sorted.findIndex((b) => b.id === anchorBlockId);
  if (anchorIdx < 0) return null;
  let lo = anchorIdx;
  while (lo > 0 && sorted[lo - 1].endMin === sorted[lo].startMin) lo--;
  let hi = anchorIdx;
  while (hi + 1 < sorted.length && sorted[hi].endMin === sorted[hi + 1].startMin) hi++;
  const mergedStartMin = sorted[lo].startMin;
  const mergedEndMin = sorted[hi].endMin;
  const blockIds = sorted.slice(lo, hi + 1).map((b) => b.id);
  return { blockIds, mergedStartMin, mergedEndMin };
}

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

  /** Walk `from` … `to` as calendar YYYY-MM-DD using UTC noon anchors so labels match occurrence_date everywhere (fixes PT grid when server TZ is not UTC). */
  const blocks: { id: number; trainer: string; trainer_member_id?: string | null; date: string; start_time: string; end_time: string; description?: string | null }[] = [];
  let dateStr = from;
  while (dateStr <= to) {
    const day = new Date(dateStr + "T12:00:00Z").getUTCDay();
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
    dateStr = addDaysToDateStr(dateStr, 1);
  }
  return blocks;
}

export type UnavailableOccurrence = { id: number; trainer: string; date: string; start_time: string; end_time: string; description: string };

/** Expand unavailable_blocks to date range. trainer '' means facility-wide. Supports one-time and recurring (with weeks_count). */
export function getUnavailableInRange(from: string, to: string): UnavailableOccurrence[] {
  const db = getDb();
  ensurePTSlotTables(db);
  const rows = db.prepare(
    "SELECT id, trainer, day_of_week, start_time, end_time, description, recurrence_type, occurrence_date, weeks_count FROM unavailable_blocks"
  ).all() as {
    id: number;
    trainer: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    description: string;
    recurrence_type?: string | null;
    occurrence_date?: string | null;
    weeks_count?: number | null;
  }[];
  db.close();
  const out: UnavailableOccurrence[] = [];
  let dateStr = from;
  while (dateStr <= to) {
    const curMidUtc = new Date(dateStr + "T12:00:00Z");
    const day = curMidUtc.getUTCDay();
    for (const r of rows) {
      const recurrenceType = (r.recurrence_type ?? "recurring").toLowerCase();
      if (recurrenceType === "one_time") {
        if (r.occurrence_date === dateStr) {
          out.push({
            id: r.id,
            trainer: r.trainer ?? "",
            date: dateStr,
            start_time: r.start_time,
            end_time: r.end_time,
            description: r.description ?? "",
          });
        }
      } else {
        if (r.day_of_week !== day) continue;
        const startDate = r.occurrence_date ? new Date(r.occurrence_date + "T12:00:00Z") : new Date(0);
        if (curMidUtc < startDate) continue;
        const weeksCount = r.weeks_count;
        if (weeksCount != null && weeksCount > 0) {
          const endDate = new Date(startDate.getTime());
          endDate.setUTCDate(endDate.getUTCDate() + (weeksCount - 1) * 7);
          if (curMidUtc > endDate) continue;
        }
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
    dateStr = addDaysToDateStr(dateStr, 1);
  }
  return out;
}

export function getBookingsForBlock(db: ReturnType<typeof getDb>, trainer_availability_id: number, occurrence_date: string): { start_time: string; reserved_minutes: number }[] {
  const rows = db.prepare(
    "SELECT start_time, reserved_minutes FROM pt_trainer_specific_bookings WHERE trainer_availability_id = ? AND occurrence_date = ? ORDER BY start_time"
  ).all(trainer_availability_id, occurrence_date) as { start_time: string; reserved_minutes: number }[];
  return rows;
}

/** Bookings for any of the given availability rows (e.g. a contiguous chain). */
export function getBookingsForBlocks(
  db: ReturnType<typeof getDb>,
  trainer_availability_ids: number[],
  occurrence_date: string
): { start_time: string; reserved_minutes: number }[] {
  const ids = [...new Set(trainer_availability_ids)].filter((id) => id > 0);
  if (ids.length === 0) return [];
  if (ids.length === 1) return getBookingsForBlock(db, ids[0], occurrence_date);
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT start_time, reserved_minutes FROM pt_trainer_specific_bookings WHERE trainer_availability_id IN (${placeholders}) AND occurrence_date = ? ORDER BY start_time`
    )
    .all(...ids, occurrence_date) as { start_time: string; reserved_minutes: number }[];
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

/** Segment of a block: free (AVAILABLE), booked (with member_name, booking_id, payment_type), or unavailable (with description). */
export type BlockSegment = {
  start_time: string;
  end_time: string;
  booked: boolean;
  member_name?: string;
  member_id?: string;
  trainer: string;
  unavailable?: boolean;
  /** When `unavailable`, row id in `unavailable_blocks` (for trainer/admin removing a one-time block). */
  unavailable_block_id?: number;
  description?: string;
  booking_id?: number;
  payment_type?: string;
};

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
    `SELECT b.id, b.start_time, b.reserved_minutes, b.member_id, b.payment_type, m.first_name, m.last_name
     FROM pt_trainer_specific_bookings b LEFT JOIN members m ON m.member_id = b.member_id
     WHERE b.trainer_availability_id = ? AND b.occurrence_date = ? ORDER BY b.start_time`
  ).all(block.id, occurrence_date) as { id: number; start_time: string; reserved_minutes: number; member_id: string; payment_type: string; first_name: string | null; last_name: string | null }[];
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
    segments.push({
      start_time: minutesToTime(startMin),
      end_time: minutesToTime(endMin),
      booked: true,
      member_name,
      member_id: b.member_id,
      trainer: block.trainer,
      booking_id: b.id,
      payment_type: b.payment_type ?? "paid",
      ...(blockDesc && { description: blockDesc }),
    });
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
        unavailable_block_id: u.id,
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
