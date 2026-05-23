/** App-wide timezone default (Hawaii). Overridden by gym setting in DB. */
export const APP_TIMEZONE = "Pacific/Honolulu";

/**
 * Parse timestamps from SQLite/API that use UTC wall time but omit a `Z` suffix
 * (e.g. `datetime('now')` → `YYYY-MM-DD HH:MM:SS`). Browsers would otherwise treat
 * that as **local** time and show gym zones (e.g. Hawaii) ~10h off.
 *
 * Date-only `YYYY-MM-DD` uses noon UTC so calendar formatting matches other app helpers.
 */
export function parseStoredUtcToDate(raw: string): Date {
  const s = raw.trim();
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T12:00:00Z`);
  }
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s);
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) {
    // SQLite `datetime('now')` etc.: UTC wall time without `Z`
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

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
  return formatInAppTz(parseStoredUtcToDate(iso), options, timeZone);
}

/** Format a YYYY-MM-DD date string for display in the given timezone (default APP_TIMEZONE). */
export function formatDateOnlyInAppTz(
  dateStr: string,
  options: DateFormatOptions = { weekday: "long", month: "short", day: "numeric", year: "numeric" },
  timeZone: string = APP_TIMEZONE
): string {
  return formatInAppTz(new Date(dateStr + "T12:00:00Z"), options, timeZone);
}

/** Format a YYYY-MM-DD date string for display as MM/DD/YYYY. Returns "" for null/invalid.
 *  Also accepts SQLite/datetime strings (`YYYY-MM-DD HH:MM:SS`) and ISO timestamps — not only date-only. */
export function formatDateForDisplay(dateStr: string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const s = dateStr.trim();
  if (!s) return "";
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(`${s}T12:00:00Z`);
  } else {
    d = parseStoredUtcToDate(s);
  }
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

/**
 * Whole calendar days from `todayYmd` until `expiryYmd` (gym date strings).
 * Same calendar day => 0; negative if expiry is in the past.
 * Prefer this for UI instead of stored `subscriptions.days_remaining`, which is only updated on renew/checkout.
 */
export function calendarDaysUntilExpiryYmd(
  expiryYmd: string | null | undefined,
  todayYmd: string
): number | null {
  const expNorm = normalizeDateToYMD(expiryYmd);
  const todayNorm = normalizeDateToYMD(todayYmd);
  if (!expNorm || !todayNorm) return null;
  const [ey, em, ed] = expNorm.split("-").map((x) => parseInt(x, 10));
  const [ty, tm, td] = todayNorm.split("-").map((x) => parseInt(x, 10));
  const exp = Date.UTC(ey, em - 1, ed);
  const tod = Date.UTC(ty, tm - 1, td);
  return Math.round((exp - tod) / 86400000);
}

/**
 * Count whole calendar pause days credited when unpausing membership (freeze through day before resume).
 * Pause start Jun 10, resume Jun 12 → freeze Jun 10–Jun 11 ⇒ 2 calendar days ⇒ extend expiry by +2.
 * Same‑day pause+resume ⇒ 0.
 */
export function pausedCalendarDaysCreditedTowardExpiry(pauseStartYmd: string, resumeYmd: string): number {
  const startNorm = normalizeDateToYMD(pauseStartYmd);
  const resumeNorm = normalizeDateToYMD(resumeYmd);
  if (!startNorm || !resumeNorm) return 0;
  const lastFrozenDay = addDaysToDateStr(resumeNorm, -1);
  if (lastFrozenDay < startNorm) return 0;
  const d = calendarDaysUntilExpiryYmd(lastFrozenDay, startNorm);
  return d !== null ? d + 1 : 0;
}

/** Format a Date as YYYY-MM-DD for storage. Use this for all date-only DB columns. */
export function formatDateForStorage(date: Date, timeZone: string = APP_TIMEZONE): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

/** `Intl` formatter shared by gym-local comparisons (24h padded fields). */
function wallClockComparableFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Padded `YYYY-MM-DDTHH:mm:ss` for `when` interpreted in `timeZone`.
 * Lexicographic order matches chronological order for sane wall times.
 * Use to compare booking `YYYY-MM-DD` + `HH:mm(:ss)` strings stored as gym-local.
 */
export function comparableDateTimeKeyInTz(when: Date, timeZone: string): string {
  const dtf = wallClockComparableFormatter(timeZone);
  const p = dtf.formatToParts(when);
  const num = (t: Intl.DateTimeFormatPartTypes) => parseInt(p.find((z) => z.type === t)?.value ?? "", 10) || 0;
  const y = num("year");
  const mo = num("month");
  const d = num("day");
  const h = num("hour");
  const mi = num("minute");
  const s = num("second");
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Interpret `dateYmd` + `wallTimeRaw` (HH:mm or HH:mm:ss) as gym wall clock in `timeZone`, return UTC ms.
 * Spring-forward DST gaps may return NaN when no matching instant exists.
 */
export function utcMillisFromWallClockInTz(dateYmd: string, wallTimeRaw: string, timeZone: string): number {
  const parts = dateYmd.split("-").map((s) => s.trim());
  const yT = parseInt(parts[0] ?? "", 10);
  const moT = parseInt(parts[1] ?? "", 10);
  const dT = parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(yT) || !Number.isFinite(moT) || !Number.isFinite(dT)) return NaN;
  const tp = wallTimeRaw.trim().split(":");
  const hT = parseInt(tp[0] ?? "", 10);
  const miT = parseInt(tp[1] ?? "0", 10);
  const sT = parseInt(tp[2] ?? "0", 10);
  if (!Number.isFinite(hT) || !Number.isFinite(miT) || !Number.isFinite(sT)) return NaN;

  const want = `${String(yT).padStart(4, "0")}-${String(moT).padStart(2, "0")}-${String(dT).padStart(2, "0")}T${String(hT).padStart(2, "0")}:${String(miT).padStart(2, "0")}:${String(sT).padStart(2, "0")}`;
  const dtf = wallClockComparableFormatter(timeZone);

  function readKey(ms: number): string {
    const p = dtf.formatToParts(new Date(ms));
    const num = (t: Intl.DateTimeFormatPartTypes) => parseInt(p.find((z) => z.type === t)?.value ?? "", 10) || 0;
    const y = num("year");
    const mo = num("month");
    const d = num("day");
    const h = num("hour");
    const mi = num("minute");
    const s = num("second");
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  let lo = Date.UTC(yT, moT - 1, dT, 12, 0, 0, 0) - 10 * 86400000;
  let hi = Date.UTC(yT, moT - 1, dT, 12, 0, 0, 0) + 10 * 86400000;

  let guard = 256;
  while (readKey(lo) > want && guard-- > 0) lo -= 3600000;
  guard = 256;
  while (readKey(hi) < want && guard-- > 0) hi += 3600000;

  if (readKey(lo) > want || readKey(hi) < want) return NaN;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const k = readKey(mid);
    if (k >= want) hi = mid;
    else lo = mid;
  }

  for (let ms = lo; ms <= hi; ms++) {
    if (readKey(ms) === want) return ms;
  }

  return NaN;
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
  return parseStoredUtcToDate(iso).toLocaleDateString("en-CA", { timeZone });
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

/** Start of day (midnight) in the given timezone as ISO string. */
export function startOfDayInTz(dateStr: string, timeZone: string = APP_TIMEZONE): string {
  const d = new Date(dateStr + "T12:00:00.000Z");
  const str = d.toLocaleString("en-CA", { timeZone });
  const parts = str.split(", ");
  const timePart = (parts[1] ?? "00:00:00").replace(/\s*(?:a\.?m\.?|p\.?m\.?)/i, "").trim();
  const [h, m, s] = timePart.split(":").map((x) => parseInt(String(x), 10) || 0);
  const hoursIntoDay = h + m / 60 + s / 3600;
  const startMs = d.getTime() - hoursIntoDay * 60 * 60 * 1000;
  return new Date(startMs).toISOString().slice(0, 23);
}

/** End of day (23:59:59.999) in the given timezone as ISO string for SQL comparison. */
export function endOfDayInTz(dateStr: string, timeZone: string = APP_TIMEZONE): string {
  const d = new Date(dateStr + "T12:00:00.000Z");
  const str = d.toLocaleString("en-CA", { timeZone });
  const parts = str.split(", ");
  const timePart = (parts[1] ?? "00:00:00").replace(/\s*(?:a\.?m\.?|p\.?m\.?)/i, "").trim();
  const [h, m, s] = timePart.split(":").map((x) => parseInt(String(x), 10) || 0);
  const hoursIntoDay = h + m / 60 + s / 3600;
  const startMs = d.getTime() - hoursIntoDay * 60 * 60 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return new Date(endMs).toISOString().slice(0, 23);
}
