/** Recurring class `session_kind` value for Open Group Personal Training / Small-Group PT. */
export const SESSION_KIND_STANDARD = "standard";
export const SESSION_KIND_OPEN_GROUP_PT = "open_group_pt";

export const SMALL_GROUP_PT_DISPLAY_NAME = "Small-Group PT";

export const OPEN_GROUP_MAX_PARTICIPANTS = 4;
/** Per-hour desk rate for Small-Group PT (pay at gym). */
export const OPEN_GROUP_HOURLY_RATE = 80;
/** Default flat fee label for one hour (legacy rows / copy). */
export const OPEN_GROUP_DEFAULT_FLAT_PRICE = "80.00";

export const SMALL_GROUP_PT_HOUR_OPTIONS = [1, 2] as const;
export type SmallGroupPtHours = (typeof SMALL_GROUP_PT_HOUR_OPTIONS)[number];

export function normalizeSmallGroupPtHours(raw: unknown): SmallGroupPtHours {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return n === 2 ? 2 : 1;
}

export function smallGroupPtDurationMinutes(hours: SmallGroupPtHours): number {
  return hours * 60;
}

export function smallGroupPtFlatPriceForHours(hours: SmallGroupPtHours): string {
  return (OPEN_GROUP_HOURLY_RATE * hours).toFixed(2);
}

/** Short label for booking UI, e.g. "$80/hr" or "$160 (2 hrs)". */
export function smallGroupPtPriceSummary(hours: SmallGroupPtHours): string {
  if (hours === 1) return `$${OPEN_GROUP_HOURLY_RATE}/hr`;
  const total = OPEN_GROUP_HOURLY_RATE * hours;
  return `$${total} (${hours} hrs × $${OPEN_GROUP_HOURLY_RATE}/hr)`;
}

export function isOpenGroupSessionKind(kind: string | null | undefined): boolean {
  return String(kind ?? "").trim() === SESSION_KIND_OPEN_GROUP_PT;
}

export function effectiveOpenGroupCapacity(storedCapacity: number | null | undefined): number {
  const n = typeof storedCapacity === "number" && storedCapacity > 0 ? storedCapacity : OPEN_GROUP_MAX_PARTICIPANTS;
  return Math.min(n, OPEN_GROUP_MAX_PARTICIPANTS);
}
