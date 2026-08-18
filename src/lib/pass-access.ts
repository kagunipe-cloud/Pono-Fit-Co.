import type { getDb } from "./db";
import { expiryDateSortableSql, WEEKLY_GOALS_BOARD_ACCESS_LEVEL } from "./db";
import { normalizeDateToYMD, todayInAppTz } from "./app-timezone";
import { ensureMembersPassActivationDayColumn } from "./day-pass-credits";
import { calendarMembershipDoorAccessOnDay } from "./cart-membership-start";

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
    if (String(s.subscription_pause_started ?? "").trim() !== "") return false;
    return calendarMembershipDoorAccessOnDay(s, todayYmd);
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
                AND TRIM(COALESCE(s.subscription_pause_started, '')) = ''
                AND TRIM(COALESCE(s.expiry_date, '')) != ''
                AND (TRIM(COALESCE(s.start_date, '')) = '' OR s.start_date <= ?)
                AND s.expiry_date >= ?
              )
            )
          )
       ORDER BY m.member_id`
    )
    .all(todayYmd, todayYmd, todayYmd, todayYmd) as { member_id: string }[];
  return rows.map((r) => r.member_id).filter((id) => id != null && String(id).trim() !== "");
}

/**
 * Members with an **Active door-eligible membership in the app** (our DB — not Kisi):
 * Active subscription, not paused, period not ended (or pass pack with credits).
 * Excludes inactive/expired imports and goal-board-only plans.
 */
export function listMemberIdsActiveDoorMembershipInApp(db: ReturnType<typeof getDb>, todayYmd: string): string[] {
  ensureMembersPassActivationDayColumn(db);
  const rows = db
    .prepare(
      `SELECT DISTINCT s.member_id
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.status = 'Active'
         AND TRIM(COALESCE(p.access_level, '')) != ?
         AND TRIM(COALESCE(s.subscription_pause_started, '')) = ''
         AND (
           s.pass_credits_remaining IS NOT NULL
           OR (
             s.pass_credits_remaining IS NULL
             AND TRIM(COALESCE(s.expiry_date, '')) != ''
             AND s.expiry_date >= ?
             AND (TRIM(COALESCE(s.start_date, '')) = '' OR s.start_date <= ?)
           )
         )
       ORDER BY s.member_id`
    )
    .all(WEEKLY_GOALS_BOARD_ACCESS_LEVEL, todayYmd, todayYmd) as { member_id: string }[];
  return rows.map((r) => r.member_id).filter((id) => id != null && String(id).trim() !== "");
}

/** Kisi `valid_until` for a stored period-end YYYY-MM-DD — end of that calendar day in app TZ. */
export function kisiDoorAccessValidUntilForExpiryYmd(
  expiryYmd: string | null | undefined,
  timeZone: string
): Date | null {
  const ymd = normalizeDateToYMD(expiryYmd);
  if (!ymd) return null;
  return endOfCalendarDayInTimeZone(ymd, timeZone);
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
       WHERE member_id = ? AND status = 'Active' AND pass_credits_remaining IS NULL
         AND TRIM(COALESCE(subscription_pause_started, '')) = ''
         AND (TRIM(COALESCE(start_date, '')) = '' OR start_date <= ?)
         AND expiry_date >= ?
       ORDER BY ${expiryDateSortableSql("expiry_date")} DESC LIMIT 1`
    )
    .get(memberId, today, today) as { expiry_date: string } | undefined;
  if (!other?.expiry_date?.trim()) return null;
  const ymd = normalizeDateToYMD(other.expiry_date.trim());
  if (ymd) {
    return endOfCalendarDayInTimeZone(ymd, tz);
  }
  const d = new Date(other.expiry_date.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Day-pass / pack members get Kisi access via grantAccess at activation. If that was skipped (error, older bug)
 * or the user already had kisi_id, unlock used to skip grant — Kisi then had no role and the API returned errors
 * like "no unlocks present". Refresh grant when door access today comes only from a day pass,
 * not from an active monthly subscription (monthly owns longer valid_until).
 */
export function kisiDayPassValidUntilIfUnlockShouldSync(
  db: ReturnType<typeof getDb>,
  memberId: string,
  tz: string
): Date | null {
  ensureMembersPassActivationDayColumn(db);
  const today = todayInAppTz(tz);
  const hasMonthlyDoor = db
    .prepare(
      `SELECT 1 FROM subscriptions
       WHERE member_id = ? AND status = 'Active'
         AND pass_credits_remaining IS NULL
         AND trim(COALESCE(subscription_pause_started, '')) = ''
         AND trim(COALESCE(expiry_date, '')) != ''
         AND (trim(COALESCE(start_date, '')) = '' OR start_date <= ?)
         AND expiry_date >= ?
       LIMIT 1`
    )
    .get(memberId, today, today);
  if (hasMonthlyDoor) return null;

  const memberAct = db
    .prepare("SELECT pass_activation_day FROM members WHERE member_id = ?")
    .get(memberId) as { pass_activation_day: string | null } | undefined;
  const memberDay = String(memberAct?.pass_activation_day ?? "").trim();
  if (memberDay === today) {
    return endOfCalendarDayInTimeZone(memberDay, tz);
  }
  const packSub = db
    .prepare(
      `SELECT 1 FROM subscriptions
       WHERE member_id = ? AND status = 'Active' AND pass_credits_remaining IS NOT NULL
         AND trim(COALESCE(pass_activation_day, '')) = ?
       LIMIT 1`
    )
    .get(memberId, today);
  if (packSub) {
    return endOfCalendarDayInTimeZone(today, tz);
  }
  return null;
}

/**
 * On unlock: monthly subscription period ends today (UI shows 0 days left) — refresh Kisi.
 * Older grants used noon UTC of expiry (~2 AM Hawaii), so door access often died before the 2 AM renewal cron.
 */
export function kisiMonthlyExpiryDayValidUntilIfUnlockShouldSync(
  db: ReturnType<typeof getDb>,
  memberId: string,
  tz: string
): Date | null {
  const today = todayInAppTz(tz);
  const row = db
    .prepare(
      `SELECT 1 FROM subscriptions
       WHERE member_id = ? AND status = 'Active' AND pass_credits_remaining IS NULL
         AND TRIM(COALESCE(subscription_pause_started, '')) = ''
         AND expiry_date = ?
         AND (TRIM(COALESCE(start_date, '')) = '' OR start_date <= ?)
       LIMIT 1`
    )
    .get(memberId, today, today);
  if (!row) return null;
  return endOfCalendarDayInTimeZone(today, tz);
}
