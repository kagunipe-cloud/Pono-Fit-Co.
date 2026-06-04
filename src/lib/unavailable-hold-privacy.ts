import type { NextRequest } from "next/server";
import { getAdminMemberId, getTrainerMemberId } from "./admin";
import type { BlockSegment, UnavailableOccurrence } from "./pt-availability";

/** Admins and trainers may see internal hold descriptions; members and guests may not. */
export async function canViewUnavailableHoldDescriptions(request: NextRequest): Promise<boolean> {
  if (await getAdminMemberId(request)) return true;
  return !!(await getTrainerMemberId(request));
}

export function redactUnavailableOccurrences(
  occurrences: UnavailableOccurrence[],
  staff: boolean
): UnavailableOccurrence[] {
  if (staff) return occurrences;
  return occurrences.map((o) => ({ ...o, description: "" }));
}

export function redactBlockSegments(segments: BlockSegment[], staff: boolean): BlockSegment[] {
  if (staff) return segments;
  return segments.map((s) => (s.unavailable ? { ...s, description: undefined } : s));
}
