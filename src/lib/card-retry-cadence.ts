/**
 * Auto card retry schedule after a failed off-session charge:
 * attempt 1 (due day) → +1 day → +3 days → +3 days → stop and notify staff.
 */

import type { getDb } from "./db";
import { ensureSubscriptionAutoRetryColumns } from "./db";
import { ensureScheduledCartChargesTable } from "./scheduled-cart-charge";
import { addDaysToDateStr } from "./app-timezone";
import { sendStaffEmail } from "./email";

export const CARD_AUTO_RETRY_MAX_ATTEMPTS = 4;

export type CardRetryState = {
  attempt_count: number;
  next_attempt_ymd: string | null;
  exhausted: boolean;
  staff_notified: boolean;
};

/** Days to wait after failure N (1-indexed) before the next auto attempt. */
export function daysAfterFailureForNextRetry(failureCount: number): number | null {
  if (failureCount >= CARD_AUTO_RETRY_MAX_ATTEMPTS) return null;
  if (failureCount === 1) return 1;
  if (failureCount === 2 || failureCount === 3) return 3;
  return null;
}

export function shouldRunAutoCardRetry(todayYmd: string, state: CardRetryState): boolean {
  if (state.exhausted) return false;
  const next = (state.next_attempt_ymd ?? "").trim();
  if (!next) return true;
  return todayYmd >= next;
}

export function nextStateAfterFailure(todayYmd: string, currentAttempts: number): {
  attempt_count: number;
  next_attempt_ymd: string | null;
  exhausted: boolean;
} {
  const attempt_count = currentAttempts + 1;
  const days = daysAfterFailureForNextRetry(attempt_count);
  if (days === null) {
    return { attempt_count, next_attempt_ymd: null, exhausted: true };
  }
  return {
    attempt_count,
    next_attempt_ymd: addDaysToDateStr(todayYmd, days),
    exhausted: false,
  };
}

function readRetryStateFromRow(row: {
  auto_retry_attempt_count?: number | null;
  auto_retry_next_ymd?: string | null;
  auto_retry_exhausted?: number | null;
  auto_retry_staff_notified?: number | null;
}): CardRetryState {
  return {
    attempt_count: Number(row.auto_retry_attempt_count ?? 0) || 0,
    next_attempt_ymd: row.auto_retry_next_ymd?.trim() || null,
    exhausted: (row.auto_retry_exhausted ?? 0) === 1,
    staff_notified: (row.auto_retry_staff_notified ?? 0) === 1,
  };
}

export function readSubscriptionAutoRetryState(
  sub: {
    auto_retry_attempt_count?: number | null;
    auto_retry_next_ymd?: string | null;
    auto_retry_exhausted?: number | null;
    auto_retry_staff_notified?: number | null;
  }
): CardRetryState {
  return readRetryStateFromRow(sub);
}

export function readScheduledChargeAutoRetryState(row: ScheduledChargeRetryRow): CardRetryState {
  return readRetryStateFromRow(row);
}

export type ScheduledChargeRetryRow = {
  auto_retry_attempt_count?: number | null;
  auto_retry_next_ymd?: string | null;
  auto_retry_exhausted?: number | null;
  auto_retry_staff_notified?: number | null;
};

export function recordSubscriptionAutoRetryFailure(
  db: ReturnType<typeof getDb>,
  subscriptionId: string,
  todayYmd: string,
  state: CardRetryState
): CardRetryState {
  ensureSubscriptionAutoRetryColumns(db);
  const next = nextStateAfterFailure(todayYmd, state.attempt_count);
  db.prepare(
    `UPDATE subscriptions SET
       auto_retry_attempt_count = ?,
       auto_retry_next_ymd = ?,
       auto_retry_exhausted = ?
     WHERE subscription_id = ?`
  ).run(next.attempt_count, next.next_attempt_ymd, next.exhausted ? 1 : 0, subscriptionId);
  return {
    attempt_count: next.attempt_count,
    next_attempt_ymd: next.next_attempt_ymd,
    exhausted: next.exhausted,
    staff_notified: state.staff_notified,
  };
}

export function recordScheduledChargeAutoRetryFailure(
  db: ReturnType<typeof getDb>,
  scheduledChargeId: number,
  todayYmd: string,
  state: CardRetryState
): CardRetryState {
  ensureScheduledCartChargesTable(db);
  const next = nextStateAfterFailure(todayYmd, state.attempt_count);
  db.prepare(
    `UPDATE scheduled_cart_charges SET
       auto_retry_attempt_count = ?,
       auto_retry_next_ymd = ?,
       auto_retry_exhausted = ?
     WHERE id = ?`
  ).run(next.attempt_count, next.next_attempt_ymd, next.exhausted ? 1 : 0, scheduledChargeId);
  return {
    attempt_count: next.attempt_count,
    next_attempt_ymd: next.next_attempt_ymd,
    exhausted: next.exhausted,
    staff_notified: state.staff_notified,
  };
}

export function clearSubscriptionAutoRetryState(db: ReturnType<typeof getDb>, subscriptionId: string) {
  ensureSubscriptionAutoRetryColumns(db);
  db.prepare(
    `UPDATE subscriptions SET
       auto_retry_attempt_count = 0,
       auto_retry_next_ymd = NULL,
       auto_retry_exhausted = 0,
       auto_retry_staff_notified = 0
     WHERE subscription_id = ?`
  ).run(subscriptionId);
}

export function clearScheduledChargeAutoRetryState(db: ReturnType<typeof getDb>, scheduledChargeId: number) {
  ensureScheduledCartChargesTable(db);
  db.prepare(
    `UPDATE scheduled_cart_charges SET
       auto_retry_attempt_count = 0,
       auto_retry_next_ymd = NULL,
       auto_retry_exhausted = 0,
       auto_retry_staff_notified = 0
     WHERE id = ?`
  ).run(scheduledChargeId);
}

export function markSubscriptionAutoRetryStaffNotified(db: ReturnType<typeof getDb>, subscriptionId: string) {
  ensureSubscriptionAutoRetryColumns(db);
  db.prepare("UPDATE subscriptions SET auto_retry_staff_notified = 1 WHERE subscription_id = ?").run(subscriptionId);
}

export function markScheduledChargeAutoRetryStaffNotified(db: ReturnType<typeof getDb>, scheduledChargeId: number) {
  ensureScheduledCartChargesTable(db);
  db.prepare("UPDATE scheduled_cart_charges SET auto_retry_staff_notified = 1 WHERE id = ?").run(scheduledChargeId);
}

export async function sendAutoRetryExhaustedStaffEmail(params: {
  kind: "renewal" | "scheduled_cart";
  memberName: string;
  memberEmail: string | null;
  memberId: string;
  label: string;
  amountDollars: string;
  lastReason: string;
  moneyOwedUrl?: string;
}): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const moneyOwedLink = params.moneyOwedUrl ?? (base ? `${base}/money-owed` : "/money-owed");
  const kindLabel = params.kind === "renewal" ? "Membership renewal" : "Scheduled cart charge";
  const subject = `Card auto-retry exhausted — ${params.memberName}`;
  const text = [
    `${kindLabel} failed after ${CARD_AUTO_RETRY_MAX_ATTEMPTS} automatic card attempts (next day, then +3 days, then +3 days).`,
    "",
    `Member: ${params.memberName}`,
    params.memberEmail ? `Email: ${params.memberEmail}` : null,
    `Member ID: ${params.memberId}`,
    `Item: ${params.label}`,
    `Amount: ${params.amountDollars}`,
    `Last error: ${params.lastReason}`,
    "",
    `This is flagged in Money owed. No further automatic card retries will run until you retry manually or the member updates their card.`,
    "",
    `Money owed: ${moneyOwedLink}`,
  ]
    .filter((line) => line != null)
    .join("\n");
  return sendStaffEmail(subject, text);
}
