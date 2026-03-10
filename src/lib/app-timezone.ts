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

/** Format a YYYY-MM-DD date string for display as MM/DD/YYYY. Returns "" for null/invalid. */
export function formatDateForDisplay(dateStr: string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const s = dateStr.trim();
  if (!s) return "";
  const d = new Date(s + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone });
}

/** Short weekday for a YYYY-MM-DD date in the given timezone (default APP_TIMEZONE). */
export function formatWeekdayShortInAppTz(dateStr: string, timeZone: string = APP_TIMEZONE): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), { weekday: "short" }, timeZone);
}

/** Today's date (YYYY-MM-DD) in the given timezone (default APP_TIMEZONE). */
export function todayInAppTz(timeZone: string = APP_TIMEZONE): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

/** Format a Date as YYYY-MM-DD for storage. Use this for all date-only DB columns. */
export function formatDateForStorage(date: Date, timeZone: string = APP_TIMEZONE): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

/** Parse any app date string to YYYY-MM-DD. Returns null if invalid. Use for migration/normalization. */
export function normalizeDateToYMD(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymd = parseAppDateToYMD(s);
  if (!ymd) return null;
  const [y, m, d] = ymd;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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

/** Parse app date string to [year, month, day] for comparison. Returns null if invalid.
 * Handles: M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD (ISO), YYYY/MM/DD */
export function parseAppDateToYMD(dateStr: string | null | undefined): [number, number, number] | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();
  if (!s) return null;

  const slashParts = s.split("/");
  const dashParts = s.split("-");

  let month: number;
  let day: number;
  let year: number;

  if (slashParts.length === 3) {
    month = parseInt(slashParts[0]!, 10);
    day = parseInt(slashParts[1]!, 10);
    year = parseInt(slashParts[2]!, 10);
  } else if (dashParts.length === 3) {
    const first = parseInt(dashParts[0]!, 10);
    const second = parseInt(dashParts[1]!, 10);
    const third = parseInt(dashParts[2]!, 10);
    if (first > 31) {
      year = first;
      month = second;
      day = third;
    } else {
      month = first;
      day = second;
      year = third;
    }
  } else {
    return null;
  }

  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  return [year, month, day];
}

/** Compare two [year, month, day] arrays. Returns true if a >= b. */
export function ymdGte(a: [number, number, number] | null, b: [number, number, number] | null): boolean {
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}
