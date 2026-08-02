import { normalizeDateToYMD, todayInAppTz } from "./app-timezone";

export const SAME_DAY_SCHEDULING_MESSAGE =
  "Please call for any same day scheduling, as we may have different availability within 24 hours.";

/** True when `dateYmd` is today on the gym calendar. */
export function isSameDayAppointment(dateYmd: string | null | undefined, tz: string): boolean {
  const norm = normalizeDateToYMD(String(dateYmd ?? "").trim());
  if (!norm) return false;
  return norm === todayInAppTz(tz);
}
