/** App-wide timezone: Hawaii (no DST). Use for all user-facing date/time display. */
export const APP_TIMEZONE = "Pacific/Honolulu";

type DateFormatOptions = Intl.DateTimeFormatOptions;

/** Format a Date in app timezone. Always adds timeZone: APP_TIMEZONE. */
export function formatInAppTz(
  date: Date,
  options: DateFormatOptions & Intl.DateTimeFormatOptions = {}
): string {
  return date.toLocaleDateString("en-US", { ...options, timeZone: APP_TIMEZONE });
}

/** Format a Date as date + time in app timezone (e.g. for receipts or logs). */
export function formatDateTimeInAppTz(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }
): string {
  return date.toLocaleString("en-US", { ...options, timeZone: APP_TIMEZONE });
}

/** Format an ISO date string (or null) in app timezone. Returns "" for null. */
export function formatDateInAppTz(
  iso: string | null,
  options: DateFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }
): string {
  if (!iso) return "";
  return formatInAppTz(new Date(iso), options);
}

/** Format a YYYY-MM-DD date string for display (e.g. "Mon, Feb 3, 2025") in app timezone. */
export function formatDateOnlyInAppTz(
  dateStr: string,
  options: DateFormatOptions = { weekday: "long", month: "short", day: "numeric", year: "numeric" }
): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), options);
}

/** Short weekday for a YYYY-MM-DD date (e.g. "Mon") in app timezone. */
export function formatWeekdayShortInAppTz(dateStr: string): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), { weekday: "short" });
}

/** Today's date (YYYY-MM-DD) in app timezone (Hawaiian). Use for journal "today" and API defaults. */
export function todayInAppTz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** Date (YYYY-MM-DD) in app timezone for a given ISO timestamp (e.g. from DB created_at). */
export function dateStringInAppTz(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** Monday (YYYY-MM-DD) of the week containing the given date string. */
export function weekStartInAppTz(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}
