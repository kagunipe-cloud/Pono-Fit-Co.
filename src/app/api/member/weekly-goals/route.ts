import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getMemberWorkoutGoal, getMemberWeeklyGoalMetrics } from "@/lib/goal-board";
import {
  getMemberWeeklyPersonalGoalProgress,
  saveMemberWeeklyPersonalGoals,
  type WeighDirection,
} from "@/lib/weekly-personal-goals";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET — current week workout goal link data + personal goals + progress. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    const tz = getAppTimezone(db);
    ensureJournalTables(db);

    const workouts_per_week = getMemberWorkoutGoal(db, memberId);
    const personal = getMemberWeeklyPersonalGoalProgress(db, memberId, tz);
    const metrics = getMemberWeeklyGoalMetrics(db, memberId, tz);

    db.close();

    return NextResponse.json({
      timezone: tz,
      week_start: metrics.week_start,
      week_end: metrics.week_end,
      workouts_per_week,
      workout_days_per_week: workouts_per_week,
      macro_goals_set: metrics.macro_goals_set,
      workouts: metrics.workouts,
      macros: metrics.macros,
      personal,
    });
  } catch (err) {
    console.error("[member/weekly-goals GET]", err);
    return NextResponse.json({ error: "Failed to load weekly goals" }, { status: 500 });
  }
}

/** PATCH — save personal goals for the current week. Workouts/macros still edited on their pages. */
export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    const tz = getAppTimezone(db);

    const weighDirRaw = body.weigh_direction;
    const weighDirection: WeighDirection | null | undefined =
      weighDirRaw === null || weighDirRaw === undefined
        ? weighDirRaw
        : String(weighDirRaw).trim() === "at_or_below" || String(weighDirRaw).trim() === "below"
          ? "at_or_below"
          : String(weighDirRaw).trim() === "at_or_above" || String(weighDirRaw).trim() === "above"
            ? "at_or_above"
            : undefined;

    if (weighDirRaw != null && weighDirection === undefined) {
      db.close();
      return NextResponse.json({ error: "weigh_direction must be at_or_below or at_or_above" }, { status: 400 });
    }

    try {
      saveMemberWeeklyPersonalGoals(db, memberId, tz, {
        pr_exercise_id: body.pr_exercise_id,
        pr_weight_lbs: body.pr_weight_lbs,
        pr_weight_at_reps: body.pr_weight_at_reps ?? body.pr_reps,
        pr_reps_at_weight_lbs: body.pr_reps_at_weight_lbs,
        pr_reps_target: body.pr_reps_target,
        weigh_target_lbs: body.weigh_target_lbs,
        weigh_direction: weighDirection,
        clear_pr: body.clear_pr === true,
        clear_weight_pr: body.clear_weight_pr === true,
        clear_reps_pr: body.clear_reps_pr === true,
        clear_weigh: body.clear_weigh === true,
      });
    } catch (e) {
      db.close();
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid goals" }, { status: 400 });
    }

    const personal = getMemberWeeklyPersonalGoalProgress(db, memberId, tz);
    db.close();

    return NextResponse.json({ ok: true, personal });
  } catch (err) {
    console.error("[member/weekly-goals PATCH]", err);
    return NextResponse.json({ error: "Failed to save weekly goals" }, { status: 500 });
  }
}
