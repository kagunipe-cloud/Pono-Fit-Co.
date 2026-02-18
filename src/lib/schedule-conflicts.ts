/**
 * Helpers to prevent scheduling a class and a PT session at the same time.
 */

import { getDb } from "./db";
import { ensureRecurringClassesTables } from "./recurring-classes";
import { ensurePTSlotTables } from "./pt-slots";
import { getUnavailableInRange } from "./pt-availability";

const SLOT_MINUTES = 30;
const PT_BUFFER_MINUTES = 15;

function slotKey(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function parseTimeToMinutes(t: string | null): number {
  if (!t || !String(t).trim()) return 0;
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return (h % 24) * 60 + m;
}

function parsePTDateTime(dt: string | null): { date: string; timeMinutes: number } | null {
  if (!dt || !dt.trim()) return null;
  const s = dt.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{1,2}):(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const timeMinutes = (parseInt(iso[4], 10) % 24) * 60 + (parseInt(iso[5], 10) || 0);
    return { date, timeMinutes };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toISOString().slice(0, 10);
  const timeMinutes = d.getHours() * 60 + d.getMinutes();
  return { date, timeMinutes };
}

/** Returns true if a PT session or PT open booking exists at the same date and 30-min slot as the given time. */
export function hasPTAtSlot(db: ReturnType<typeof getDb>, date: string, timeMinutes: number): boolean {
  const key = slotKey(timeMinutes);
  ensurePTSlotTables(db);
  const sessionRows = db.prepare("SELECT id, date_time FROM pt_sessions").all() as { id: number; date_time: string | null }[];
  for (const r of sessionRows) {
    const parsed = parsePTDateTime(r.date_time);
    if (parsed && parsed.date === date && slotKey(parsed.timeMinutes) === key) return true;
  }
  const openRows = db.prepare("SELECT occurrence_date, start_time, duration_minutes FROM pt_open_bookings WHERE occurrence_date = ?").all(date) as { occurrence_date: string; start_time: string; duration_minutes: number }[];
  const slotEnd = key + SLOT_MINUTES;
  for (const r of openRows) {
    const bStart = parseTimeToMinutes(r.start_time);
    const bEnd = bStart + (r.duration_minutes ?? 60);
    const bufferEnd = bEnd + PT_BUFFER_MINUTES;
    if (key < bufferEnd && slotEnd > bStart && !(slotEnd === bEnd)) return true;
  }
  return false;
}

/** Returns true if a class occurrence exists at the same date and 30-min slot as the given time. */
export function hasClassAtSlot(db: ReturnType<typeof getDb>, date: string, timeMinutes: number): boolean {
  ensureRecurringClassesTables(db);
  const key = slotKey(timeMinutes);
  const rows = db.prepare(`
    SELECT occurrence_date, occurrence_time FROM class_occurrences
    WHERE occurrence_date = ? AND (class_id IS NOT NULL OR recurring_class_id IS NOT NULL)
  `).all(date) as { occurrence_date: string; occurrence_time: string }[];
  for (const r of rows) {
    const min = parseTimeToMinutes(r.occurrence_time);
    if (slotKey(min) === key) return true;
  }
  return false;
}

/**
 * Returns true if [startMin, startMin+durationMinutes] is free for a PT booking.
 * No overlap with classes, unavailable, block bookings, or other PT open bookings.
 * PT buffer: nothing may start in (ourEnd, ourEnd+15]; OK if something starts exactly when we end.
 */
export function isPTBookingSlotFree(
  db: ReturnType<typeof getDb>,
  date: string,
  startMin: number,
  durationMinutes: number
): boolean {
  const endMin = startMin + durationMinutes;
  for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
    if (hasClassAtSlot(db, date, m)) return false;
  }
  const unavail = getUnavailableInRange(date, date);
  for (const u of unavail) {
    if (u.date !== date) continue;
    const uStart = parseTimeToMinutes(u.start_time);
    const uEnd = parseTimeToMinutes(u.end_time);
    if (startMin < uEnd && endMin > uStart) return false;
  }
  ensurePTSlotTables(db);
  const openBookings = db
    .prepare("SELECT occurrence_date, start_time, duration_minutes FROM pt_open_bookings WHERE occurrence_date = ?")
    .all(date) as { occurrence_date: string; start_time: string; duration_minutes: number }[];
  for (const b of openBookings) {
    const bStart = parseTimeToMinutes(b.start_time);
    const bEnd = bStart + (b.duration_minutes ?? 60);
    if (startMin < bEnd && endMin > bStart) return false;
    if (bStart > endMin && bStart <= endMin + PT_BUFFER_MINUTES) return false;
  }
  const blockBookings = db
    .prepare("SELECT start_time, reserved_minutes FROM pt_block_bookings WHERE occurrence_date = ?")
    .all(date) as { start_time: string; reserved_minutes: number }[];
  for (const b of blockBookings) {
    const bStart = parseTimeToMinutes(b.start_time);
    const bEnd = bStart + b.reserved_minutes;
    if (startMin < bEnd && endMin > bStart) return false;
  }
  return true;
}

/** Parse date (YYYY-MM-DD) and time string to timeMinutes. For one-off class conflict check. */
export function classDateTimeToMinutes(date: string, time: string): number {
  return parseTimeToMinutes(time);
}

/** Parse PT date_time to { date, timeMinutes }. For PT conflict check. */
export function ptDateTimeToSlot(dt: string | null): { date: string; timeMinutes: number } | null {
  return parsePTDateTime(dt);
}
