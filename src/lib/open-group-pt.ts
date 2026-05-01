/** Recurring class `session_kind` value for Open Group Personal Training. */
export const SESSION_KIND_STANDARD = "standard";
export const SESSION_KIND_OPEN_GROUP_PT = "open_group_pt";

export const OPEN_GROUP_MAX_PARTICIPANTS = 4;
/** Default flat fee label / desk charge (actual payment at gym). */
export const OPEN_GROUP_DEFAULT_FLAT_PRICE = "80.00";

export function isOpenGroupSessionKind(kind: string | null | undefined): boolean {
  return String(kind ?? "").trim() === SESSION_KIND_OPEN_GROUP_PT;
}

export function effectiveOpenGroupCapacity(storedCapacity: number | null | undefined): number {
  const n = typeof storedCapacity === "number" && storedCapacity > 0 ? storedCapacity : OPEN_GROUP_MAX_PARTICIPANTS;
  return Math.min(n, OPEN_GROUP_MAX_PARTICIPANTS);
}
