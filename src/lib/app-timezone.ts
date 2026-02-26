/** App-wide timezone default (Hawaii). Overridden by gym setting in DB. */
export const APP_TIMEZONE = "Pacific/Honolulu";

type DateFormatOptions = Intl.DateTimeFormatOptions;

/** Format a Date in the given timezone (default APP_TIMEZONE). */
export function formatInAppTz(
  date: Date,
  options: DateFormatOptions & Intl.DateTimeFormatOptions = {},
  timeZone: string = APP_TIMEZONE
): string {
  return date.toLocaleDateString("en-US", { ...options, timeZone });
}

/** Format a Date as date + time in the given timezone (default APP_TIMEZONE). */
export function formatDateTimeInAppTz(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" },
  timeZone: string = APP_TIMEZONE
): string {
  return date.toLocaleString("en-US", { ...options, timeZone });
}

/** Format an ISO date string (or null) in the given timezone. Returns "" for null. */
export function formatDateInAppTz(
  iso: string | null,
  options: DateFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  timeZone: string = APP_TIMEZONE
): string {
  if (!iso) return "";
  return formatInAppTz(new Date(iso), options, timeZone);
}

/** Format a YYYY-MM-DD date string for display in the given timezone (default APP_TIMEZONE). */
export function formatDateOnlyInAppTz(
  dateStr: string,
  options: DateFormatOptions = { weekday: "long", month: "short", day: "numeric", year: "numeric" },
  timeZone: string = APP_TIMEZONE
): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), options, timeZone);
}

/** Short weekday for a YYYY-MM-DD date in the given timezone (default APP_TIMEZONE). */
export function formatWeekdayShortInAppTz(dateStr: string, timeZone: string = APP_TIMEZONE): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), { weekday: "short" }, timeZone);
}

/** Today's date (YYYY-MM-DD) in the given timezone (default APP_TIMEZONE). */
export function todayInAppTz(timeZone: string = APP_TIMEZONE): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

/** Date (YYYY-MM-DD) in the given timezone for an ISO timestamp (default APP_TIMEZONE). */
export function dateStringInAppTz(iso: string | null, timeZone: string = APP_TIMEZONE): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

/** Monday (YYYY-MM-DD) of the week containing the given date string. */
export function weekStartInAppTz(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}

/** Add days to a YYYY-MM-DD string. Returns YYYY-MM-DD. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Parse app date string "M/D/YYYY" or "MM/DD/YYYY" to [year, month, day] for comparison. Returns null if invalid. */
export function parseAppDateToYMD(dateStr: string | null | undefined): [number, number, number] | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0]!, 10);
  const day = parseInt(parts[1]!, 10);
  const year = parseInt(parts[2]!, 10);
  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

/** Compare two [year, month, day] arrays. Returns true if a >= b. */
export function ymdGte(a: [number, number, number] | null, b: [number, number, number] | null): boolean {
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}
