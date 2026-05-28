import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getMemberWorkoutGoal, normalizeWorkoutsPerWeek, setMemberWorkoutGoal } from "@/lib/goal-board";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    const workouts_per_week = getMemberWorkoutGoal(db, memberId);
    db.close();

    return NextResponse.json({ workouts_per_week, days_per_week: workouts_per_week });
  } catch (err) {
    console.error("[member/workout-goal GET]", err);
    return NextResponse.json({ error: "Failed to load workout goal" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const raw = body.workouts_per_week ?? body.days_per_week;
    const count = normalizeWorkoutsPerWeek(raw);
    if (count == null) {
      return NextResponse.json({ error: "Choose a workout goal from 1 to 14 workouts per week." }, { status: 400 });
    }

    const db = getDb();
    setMemberWorkoutGoal(db, memberId, count);
    db.close();

    return NextResponse.json({ ok: true, workouts_per_week: count, days_per_week: count });
  } catch (err) {
    console.error("[member/workout-goal PATCH]", err);
    return NextResponse.json({ error: "Failed to update workout goal" }, { status: 500 });
  }
}
