import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET — { ids: number[] } */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureWorkoutTables(db);
    const rows = db.prepare("SELECT exercise_id FROM member_exercise_favorites WHERE member_id = ? ORDER BY created_at DESC").all(memberId) as {
      exercise_id: number;
    }[];
    db.close();
    return NextResponse.json({ ids: rows.map((r) => r.exercise_id) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load favorites" }, { status: 500 });
  }
}

/** POST { exercise_id: number } — toggle favorite; returns { ids, pinned } */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const exercise_id = parseInt(String(body.exercise_id ?? ""), 10);
    if (Number.isNaN(exercise_id) || exercise_id <= 0) {
      return NextResponse.json({ error: "exercise_id required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const ex = db.prepare("SELECT id FROM exercises WHERE id = ?").get(exercise_id);
    if (!ex) {
      db.close();
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const existing = db.prepare("SELECT 1 FROM member_exercise_favorites WHERE member_id = ? AND exercise_id = ?").get(memberId, exercise_id);
    let pinned: boolean;
    if (existing) {
      db.prepare("DELETE FROM member_exercise_favorites WHERE member_id = ? AND exercise_id = ?").run(memberId, exercise_id);
      pinned = false;
    } else {
      db.prepare("INSERT INTO member_exercise_favorites (member_id, exercise_id) VALUES (?, ?)").run(memberId, exercise_id);
      pinned = true;
    }

    const rows = db.prepare("SELECT exercise_id FROM member_exercise_favorites WHERE member_id = ? ORDER BY created_at DESC").all(memberId) as {
      exercise_id: number;
    }[];
    db.close();
    return NextResponse.json({ ids: rows.map((r) => r.exercise_id), pinned });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update favorite" }, { status: 500 });
  }
}
