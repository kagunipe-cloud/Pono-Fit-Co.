import { addDaysToDateStr, normalizeDateToYMD } from "@/lib/app-timezone";

/** Program day 1 maps to `starts_on`; day N → starts_on + (N − 1) days. */
export function scheduledDateForProgramDay(startsOnYmd: string, dayIndex: number): string {
  const base = normalizeDateToYMD(startsOnYmd);
  if (!base || dayIndex < 1) return base ?? "";
  return addDaysToDateStr(base, dayIndex - 1);
}

export function assignmentProgramStartYmd(startsOn: string | null | undefined, createdAt: string | null | undefined): string {
  const fromStart = normalizeDateToYMD(startsOn);
  if (fromStart) return fromStart;
  const fromCreated = createdAt?.trim().slice(0, 10);
  if (fromCreated && /^\d{4}-\d{2}-\d{2}$/.test(fromCreated)) return fromCreated;
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM for month containing dateStr. */
export function monthKeyFromYmd(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}