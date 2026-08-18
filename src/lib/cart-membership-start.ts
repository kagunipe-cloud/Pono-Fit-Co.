import { normalizeDateToYMD, todayInAppTz } from "./app-timezone";

/** Validate staff-set membership start (today or future, gym calendar day). */
export function normalizeMembershipStartDateYmd(raw: unknown, tz: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const norm = normalizeDateToYMD(String(raw).trim());
  if (!norm) return null;
  const today = todayInAppTz(tz);
  if (norm < today) return null;
  return norm;
}

export function ymdToLocalNoonDate(ymd: string): Date {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Calendar membership (non pass-pack) counts for door access on this gym day. */
export function calendarMembershipDoorAccessOnDay(
  sub: Record<string, unknown>,
  todayYmd: string
): boolean {
  if (sub.status !== "Active") return false;
  if (String(sub.subscription_pause_started ?? "").trim() !== "") return false;
  const startNorm = normalizeDateToYMD(String(sub.start_date ?? ""));
  if (startNorm && startNorm > todayYmd) return false;
  const expNorm = normalizeDateToYMD(String(sub.expiry_date ?? ""));
  return !!expNorm && expNorm >= todayYmd;
}
