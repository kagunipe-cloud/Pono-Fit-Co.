import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { ensurePTSlotTables, getPTCreditBalance } from "../../../../lib/pt-slots";
import {
  FIRST_TIME_PT_INFO_MESSAGE,
  FIRST_TIME_PT_MIN_DURATION_MINUTES,
  FIRST_TIME_PT_SHORT_SESSION_MESSAGE,
  FIRST_TIME_PT_STACK_30_PROMPT,
  FIRST_TIME_PT_SHORT_SESSION_NO_STACK_MESSAGE,
  memberCanStackTwoThirtyCredits,
  memberIsFirstTimePtBooker,
} from "../../../../lib/first-time-pt-booking";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    const isFirstTime = memberIsFirstTimePtBooker(db, memberId);
    const credits30 = getPTCreditBalance(db, memberId, 30);
    const canStackTwo30 = isFirstTime && memberCanStackTwoThirtyCredits(credits30);
    db.close();

    return NextResponse.json({
      is_first_time_pt_booker: isFirstTime,
      required_duration_minutes: isFirstTime ? FIRST_TIME_PT_MIN_DURATION_MINUTES : null,
      first_time_info_message: isFirstTime ? FIRST_TIME_PT_INFO_MESSAGE : null,
      short_session_message: FIRST_TIME_PT_SHORT_SESSION_MESSAGE,
      short_session_no_stack_message: FIRST_TIME_PT_SHORT_SESSION_NO_STACK_MESSAGE,
      can_stack_two_30_credits: canStackTwo30,
      stack_two_30_prompt: canStackTwo30 ? FIRST_TIME_PT_STACK_30_PROMPT : null,
      thirty_min_credit_balance: credits30,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
