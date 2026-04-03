import type { getDb } from "./db";
import { expiryDateSortableSql } from "./db";
import { todayInAppTz } from "./app-timezone";

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
 * pass pack activated for today → end of that calendar day in app TZ; else standard expiry_date.
 */
export function getSubscriptionDoorAccessValidUntil(
  db: ReturnType<typeof getDb>,
  memberId: string,
  tz: string
): Date | null {
  const today = todayInAppTz(tz);
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
  const d = new Date(other.expiry_date.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
