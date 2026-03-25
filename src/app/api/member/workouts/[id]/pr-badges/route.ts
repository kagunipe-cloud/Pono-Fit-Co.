import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables, estimate1RM } from "@/lib/workouts";

export const dynamic = "force-dynamic";

type PRBadgeType = "Reps" | "Auto 1RM" | "My 1RM";

function fmtWeightLbs(w: number): string {
  if (Number.isInteger(w)) return String(w);
  return String(Math.round(w * 10) / 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function estNear(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-3;
}

/**
 * GET — Returns PR badges for a finished workout.
 * { exercises: [{ id, exercise_id, exercise_name, badges: PRBadgeType[], pr_by_set_order?: Record<string, string[]> }], workoutBadges: PRBadgeType[] }
 * pr_by_set_order maps set_order (string keys) to human-readable PR lines for that set row.
 * Only for finished workouts. workoutBadges is the union of all exercise badges (for history cards).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const workoutId = parseInt((await params).id, 10);
    if (Number.isNaN(workoutId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id, finished_at FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId) as { id: number; finished_at: string | null } | undefined;
    if (!workout || !workout.finished_at) {
      db.close();
      return NextResponse.json({ exercises: [], workoutBadges: [] });
    }

    const hasUseForMy1rm = (db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[]).some((c) => c.name === "use_for_my_1rm");
    const exCols = ["id", "workout_id", "type", "exercise_name", "exercise_id"];
    if (hasUseForMy1rm) exCols.push("use_for_my_1rm");
    const exercises = db.prepare(
      `SELECT ${exCols.join(", ")} FROM workout_exercises WHERE workout_id = ? AND type = 'lift' ORDER BY sort_order, id`
    ).all(workoutId) as { id: number; workout_id: number; type: string; exercise_name: string; exercise_id: number | null; use_for_my_1rm?: number }[];

    const setCols = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
    const hasDropIndex = setCols.includes("drop_index");
    const setSelect = hasDropIndex
      ? "SELECT reps, weight_kg, set_order, drop_index FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, drop_index, id"
      : "SELECT reps, weight_kg, set_order FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id";

    const weightTol = 0.05;
    const workoutBadgesSet = new Set<PRBadgeType>();
    const exerciseBadges: {
      id: number;
      exercise_id: number | null;
      exercise_name: string;
      badges: PRBadgeType[];
      pr_by_set_order?: Record<string, string[]>;
    }[] = [];

    for (const ex of exercises) {
      const sets = db.prepare(setSelect).all(ex.id) as {
        reps: number | null;
        weight_kg: number | null;
        set_order: number;
        drop_index?: number;
      }[];
      const badges = new Set<PRBadgeType>();
      const prNotesByOrder = new Map<number, Set<string>>();
      const addNote = (setOrder: number, line: string) => {
        if (!prNotesByOrder.has(setOrder)) prNotesByOrder.set(setOrder, new Set());
        prNotesByOrder.get(setOrder)!.add(line);
      };

      // Reps PR: first set (in order) with reps > previous max at that weight (excluding this workout)
      for (const s of sets) {
        const reps = s.reps ?? 0;
        const w = s.weight_kg ?? 0;
        if (w <= 0 || reps <= 0) continue;
        const weightLo = w - weightTol;
        const weightHi = w + weightTol;
        let prevMaxReps = 0;
        if (ex.exercise_id != null) {
          const rows = db.prepare(`
            SELECT ws.reps FROM workout_sets ws
            JOIN workout_exercises we ON we.id = ws.workout_exercise_id
            JOIN workouts w ON w.id = we.workout_id
            WHERE w.member_id = ? AND w.finished_at IS NOT NULL AND w.id != ?
              AND we.exercise_id = ? AND we.type = 'lift'
              AND ws.weight_kg >= ? AND ws.weight_kg <= ?
              AND ws.reps IS NOT NULL AND ws.reps > 0
          `).all(memberId, workoutId, ex.exercise_id, weightLo, weightHi) as { reps: number }[];
          prevMaxReps = rows.length > 0 ? Math.max(...rows.map((r) => r.reps)) : 0;
        } else {
          const rows = db.prepare(`
            SELECT ws.reps FROM workout_sets ws
            JOIN workout_exercises we ON we.id = ws.workout_exercise_id
            JOIN workouts w ON w.id = we.workout_id
            WHERE w.member_id = ? AND w.finished_at IS NOT NULL AND w.id != ?
              AND LOWER(TRIM(we.exercise_name)) = LOWER(?) AND we.type = 'lift'
              AND ws.weight_kg >= ? AND ws.weight_kg <= ?
              AND ws.reps IS NOT NULL AND ws.reps > 0
          `).all(memberId, workoutId, ex.exercise_name.trim(), weightLo, weightHi) as { reps: number }[];
          prevMaxReps = rows.length > 0 ? Math.max(...rows.map((r) => r.reps)) : 0;
        }
        if (reps > prevMaxReps) {
          badges.add("Reps");
          const note =
            prevMaxReps > 0
              ? `Reps PR — ${reps} reps @ ${fmtWeightLbs(w)} lbs (was ${prevMaxReps})`
              : `Reps PR — ${reps} reps @ ${fmtWeightLbs(w)} lbs`;
          addNote(s.set_order, note);
          break;
        }
      }

      // Auto 1RM PR: this exercise's max auto-implied 1RM > max from all other sessions
      let thisMax1RM: number | null = null;
      for (const s of sets) {
        const reps = s.reps ?? 0;
        const w = s.weight_kg ?? 0;
        if (w > 0 && reps > 0) {
          const est = estimate1RM(w, Math.min(36, reps));
          if (est != null && (thisMax1RM == null || est > thisMax1RM)) thisMax1RM = est;
        }
      }
      if (thisMax1RM != null && thisMax1RM > 0) {
        let prevMax1RM = 0;
        if (ex.exercise_id != null) {
          const otherExRows = db.prepare(`
            SELECT we.id FROM workout_exercises we
            JOIN workouts w ON w.id = we.workout_id
            WHERE w.member_id = ? AND w.finished_at IS NOT NULL AND w.id != ?
              AND we.exercise_id = ? AND we.type = 'lift'
          `).all(memberId, workoutId, ex.exercise_id) as { id: number }[];
          for (const { id: exId } of otherExRows) {
            const otherSets = db.prepare("SELECT reps, weight_kg FROM workout_sets WHERE workout_exercise_id = ?").all(exId) as { reps: number | null; weight_kg: number | null }[];
            for (const os of otherSets) {
              const r = os.reps ?? 0;
              const w = os.weight_kg ?? 0;
              if (w > 0 && r > 0) {
                const est = estimate1RM(w, Math.min(36, r));
                if (est != null && est > prevMax1RM) prevMax1RM = est;
              }
            }
          }
        } else {
          const otherExRows = db.prepare(`
            SELECT we.id FROM workout_exercises we
            JOIN workouts w ON w.id = we.workout_id
            WHERE w.member_id = ? AND w.finished_at IS NOT NULL AND w.id != ?
              AND LOWER(TRIM(we.exercise_name)) = LOWER(?) AND we.type = 'lift'
          `).all(memberId, workoutId, ex.exercise_name.trim()) as { id: number }[];
          for (const { id: exId } of otherExRows) {
            const otherSets = db.prepare("SELECT reps, weight_kg FROM workout_sets WHERE workout_exercise_id = ?").all(exId) as { reps: number | null; weight_kg: number | null }[];
            for (const os of otherSets) {
              const r = os.reps ?? 0;
              const w = os.weight_kg ?? 0;
              if (w > 0 && r > 0) {
                const est = estimate1RM(w, Math.min(36, r));
                if (est != null && est > prevMax1RM) prevMax1RM = est;
              }
            }
          }
        }
        if (thisMax1RM > prevMax1RM) {
          badges.add("Auto 1RM");
          const line = `Auto 1RM PR — ~${round1(thisMax1RM)} lbs est`;
          for (const s of sets) {
            const r = s.reps ?? 0;
            const w = s.weight_kg ?? 0;
            if (w <= 0 || r <= 0) continue;
            const est = estimate1RM(w, Math.min(36, r));
            if (est != null && estNear(est, thisMax1RM)) addNote(s.set_order, line);
          }
        }
      }

      // My 1RM PR: exercise is use_for_my_1rm and max estimated 1RM > previous My 1RM record
      if ((ex.use_for_my_1rm ?? 0) === 1 && ex.exercise_id != null && thisMax1RM != null && thisMax1RM > 0) {
        const prevRecords = db.prepare(`
          SELECT estimated_1rm_lbs FROM member_1rm_records
          WHERE member_id = ? AND exercise_id = ? AND workout_id != ?
        `).all(memberId, ex.exercise_id, workoutId) as { estimated_1rm_lbs: number }[];
        const prevMy1RM = prevRecords.length > 0 ? Math.max(...prevRecords.map((r) => r.estimated_1rm_lbs)) : 0;
        if (thisMax1RM > prevMy1RM) {
          badges.add("My 1RM");
          const line = `My 1RM PR — ~${round1(thisMax1RM)} lbs est`;
          for (const s of sets) {
            const r = s.reps ?? 0;
            const w = s.weight_kg ?? 0;
            if (w <= 0 || r <= 0) continue;
            const est = estimate1RM(w, Math.min(36, r));
            if (est != null && estNear(est, thisMax1RM)) addNote(s.set_order, line);
          }
        }
      }

      const badgeArr = [...badges];
      badgeArr.forEach((b) => workoutBadgesSet.add(b));
      const pr_by_set_order: Record<string, string[]> = {};
      for (const [ord, noteSet] of prNotesByOrder) {
        pr_by_set_order[String(ord)] = [...noteSet];
      }
      exerciseBadges.push({
        id: ex.id,
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        badges: badgeArr,
        ...(Object.keys(pr_by_set_order).length > 0 ? { pr_by_set_order } : {}),
      });
    }

    db.close();
    return NextResponse.json({
      exercises: exerciseBadges,
      workoutBadges: [...workoutBadgesSet],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load PR badges" }, { status: 500 });
  }
}
