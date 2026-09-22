import { getDb } from "./db";
import { getPTCreditBalance } from "./pt-slots";

export const FIRST_TIME_PT_MIN_DURATION_MINUTES = 60;
export const FIRST_TIME_PT_STACK_CREDIT_MINUTES = 30;
export const FIRST_TIME_PT_STACK_CREDIT_COUNT = 2;

export const FIRST_TIME_PT_INFO_MESSAGE =
  "Your first PT session includes a complimentary functional movement screen and a personalized plan, so please book a full 60-minute session.";

export const FIRST_TIME_PT_SHORT_SESSION_MESSAGE =
  "First-time PT sessions must be 60 minutes on the schedule. Your first visit includes a complimentary functional movement screen and a personalized plan — we need the extra time for that.";

export const FIRST_TIME_PT_STACK_30_PROMPT =
  "We see this is your first PT session. Your visit includes a complimentary functional movement screen and a personalized plan, so we block a full hour on the schedule. You have two 30-minute credits — you can use both for this 60-minute first visit.";

export const FIRST_TIME_PT_SHORT_SESSION_NO_STACK_MESSAGE =
  "First-time sessions need a full hour for your movement screen and plan. Please choose a 60-minute session or pay online. If you have two 30-minute credits, select a 30-minute session above to use the stack option.";

export function firstTimePtDurationTooShort(durationMinutes: number): boolean {
  return durationMinutes < FIRST_TIME_PT_MIN_DURATION_MINUTES;
}

export function memberCanStackTwoThirtyCredits(creditBalance30: number): boolean {
  return creditBalance30 >= FIRST_TIME_PT_STACK_CREDIT_COUNT;
}

/** Any prior 1-on-1 PT booking (including legacy tables). */
export function memberHasPriorOneOnOnePtBooking(db: ReturnType<typeof getDb>, memberId: string): boolean {
  const checks = [
    "SELECT 1 FROM pt_trainer_specific_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_open_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_slot_bookings WHERE member_id = ? LIMIT 1",
  ];
  for (const sql of checks) {
    try {
      if (db.prepare(sql).get(memberId)) return true;
    } catch {
      /* table may not exist */
    }
  }
  return false;
}

export function memberIsFirstTimePtBooker(db: ReturnType<typeof getDb>, memberId: string): boolean {
  return !memberHasPriorOneOnOnePtBooking(db, memberId);
}

/** Members booking PT for themselves must book 60+ min on their first session (unless stacking 2×30 credits). */
export function memberFirstTimePtDurationError(
  db: ReturnType<typeof getDb>,
  memberId: string,
  durationMinutes: number,
  opts: { isAdmin?: boolean; memberSelfBooking?: boolean; stackTwoThirtyCredits?: boolean }
): string | null {
  if (opts.stackTwoThirtyCredits) return null;
  if (opts.isAdmin) return null;
  if (opts.memberSelfBooking === false) return null;
  if (!memberIsFirstTimePtBooker(db, memberId)) return null;
  if (!firstTimePtDurationTooShort(durationMinutes)) return null;
  return FIRST_TIME_PT_SHORT_SESSION_MESSAGE;
}

export function firstTimeStackTwoThirtyCreditsError(
  db: ReturnType<typeof getDb>,
  memberId: string,
  sessionDurationMinutes: number,
  opts: { isAdmin?: boolean; memberSelfBooking?: boolean }
): string | null {
  if (opts.isAdmin) return null;
  if (opts.memberSelfBooking === false) return null;
  if (!memberIsFirstTimePtBooker(db, memberId)) {
    return "Stacked 30-minute credits are only for a first PT visit.";
  }
  if (sessionDurationMinutes !== FIRST_TIME_PT_STACK_CREDIT_MINUTES) {
    return "Stacked first-visit credits require a 30-minute session type.";
  }
  const balance = getPTCreditBalance(db, memberId, FIRST_TIME_PT_STACK_CREDIT_MINUTES);
  if (!memberCanStackTwoThirtyCredits(balance)) {
    return `You need ${FIRST_TIME_PT_STACK_CREDIT_COUNT} ${FIRST_TIME_PT_STACK_CREDIT_MINUTES}-minute PT credits for a stacked first visit.`;
  }
  return null;
}
