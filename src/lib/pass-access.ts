import type { getDb } from "./db";
import { expiryDateSortableSql } from "./db";
import { normalizeDateToYMD, todayInAppTz } from "./app-timezone";
import { ensureMembersPassActivationDayColumn } from "./day-pass-credits";

/**
 * Same rules as GET /api/member/me `hasAccess`: at least one Active subscription
 * with expiry on/after today, or a banked day pass activated for today (members.pass_activation_day).
 */
export function memberHasDoorAccessToday(
  subscriptions: Array<Record<string, unknown>>,
  todayYmd: string,
  memberPassActivationDay?: string | null
): boolean {
  if (String(memberPassActivationDay ?? "").trim() === todayYmd) return true;
  return subscriptions.some((s) => {
    if (s.status !== "Active") return false;
    const pc = s.pass_credits_remaining;
    if (pc != null && Number(pc) >= 0) {
      return String(s.pass_activation_day ?? "").trim() === todayYmd;
    }
    return String(s.expiry_date ?? "") >= todayYmd;
  });
}

/**
 * Member IDs that have door access today per the same rules as `memberHasDoorAccessToday` (SQL snapshot).
 */
export function listMemberIdsWithDoorAccessToday(db: ReturnType<typeof getDb>, todayYmd: string): string[] {
  ensureMembersPassActivationDayColumn(db);
  const rows = db
    .prepare(
      `SELECT m.member_id FROM members m
       WHERE TRIM(COALESCE(m.pass_activation_day, '')) = ?
          OR EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.member_id = m.member_id AND s.status = 'Active'
            AND (
              (s.pass_credits_remaining IS NOT NULL AND TRIM(COALESCE(s.pass_activation_day, '')) = ?)
              OR (
                s.pass_credits_remaining IS NULL
                AND TRIM(COALESCE(s.expiry_date, '')) != ''
                AND s.expiry_date >= ?
              )
            )
          )`
    )
    .all(todayYmd, todayYmd, todayYmd) as { member_id: string }[];
  return rows.map((r) => r.member_id).filter((id) => id != null && String(id).trim() !== "");
}

/** Last instant (UTC) that still falls on `ymd` in the given IANA timezone. */
export function endOfCalendarDayInTimeZone(ymd: string, timeZone: string): Date {
  const parts = ymd.trim().split("-").map(Number);
  const yy = parts[0];
  const mm = parts[1];
  const dd = parts[2];
  if (!yy || !mm || !dd) return new Date(NaN);
  const lo = Date.UTC(yy, mm - 1, dd - 1, 0, 0, 0);
  const hi = Date.UTC(yy, mm - 1, dd + 2, 0, 0, 0);
  let lastMs = lo;
  for (let t = lo; t <= hi; t += 1000) {
    if (new Date(t).toLocaleDateString("en-CA", { timeZone }) === ymd) {
      lastMs = t;
    }
  }
  return new Date(lastMs);
}

/**
 * Valid-until instant for Kisi for an active door subscription:
 * pass pack activated for today → end of that calendar day in app TZ; else monthly expiry_date as **end of that calendar day in app TZ** (not UTC midnight of the string, which is a day early in Hawaii).
 */
export function getSubscriptionDoorAccessValidUntil(
  db: ReturnType<typeof getDb>,
  memberId: string,
  tz: string
): Date | null {
  ensureMembersPassActivationDayColumn(db);
  const today = todayInAppTz(tz);
  const memberAct = db
    .prepare("SELECT pass_activation_day FROM members WHERE member_id = ?")
    .get(memberId) as { pass_activation_day: string | null } | undefined;
  const memberDay = String(memberAct?.pass_activation_day ?? "").trim();
  if (memberDay === today) {
    return endOfCalendarDayInTimeZone(memberDay, tz);
  }
  const passRow = db
    .prepare(
      `SELECT pass_activation_day FROM subscriptions
       WHERE member_id = ? AND status = 'Active' AND pass_credits_remaining IS NOT NULL
         AND pass_activation_day = ?
       LIMIT 1`
    )
    .get(memberId, today) as { pass_activation_day: string } | undefined;
  if (passRow?.pass_activation_day?.trim()) {
    return endOfCalendarDayInTimeZone(passRow.pass_activation_day.trim(), tz);
  }
  const other = db
    .prepare(
      `SELECT expiry_date FROM subscriptions
       WHERE member_id = ? AND status = 'Active' AND pass_credits_remaining IS NULL AND expiry_date >= ?
       ORDER BY ${expiryDateSortableSql("expiry_date")} DESC LIMIT 1`
    )
    .get(memberId, today) as { expiry_date: string } | undefined;
  if (!other?.expiry_date?.trim()) return null;
  const ymd = normalizeDateToYMD(other.expiry_date.trim());
  if (ymd) {
    return endOfCalendarDayInTimeZone(ymd, tz);
  }
  const d = new Date(other.expiry_date.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
