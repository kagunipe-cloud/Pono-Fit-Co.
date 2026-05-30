import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { parseExerciseType } from "@/lib/exercise-types";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/**
 * POST { recipient_email?: string, recipient_member_id?: string }.
 * Copies this finished workout (exercises + sets) to the recipient's account as a new finished workout.
 * Member-only; you can't send to yourself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const senderId = await getMemberIdFromSession();
    if (!senderId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const idParam = (await params).id;
    const workoutId = parseInt(idParam, 10);
    if (Number.isNaN(workoutId)) return NextResponse.json({ error: "Invalid workout id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const recipientMemberId = (body.recipient_member_id ?? "").toString().trim();
    const recipientEmail = (body.recipient_email ?? "").toString().trim().toLowerCase();
    if (!recipientMemberId && !recipientEmail) {
      return NextResponse.json({ error: "recipient_email or recipient_member_id is required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const workout = db.prepare("SELECT id, member_id, finished_at, name FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, senderId) as { id: number; member_id: string; finished_at: string | null; name?: string | null } | undefined;
    if (!workout) {
      db.close();
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (!workout.finished_at) {
      db.close();
      return NextResponse.json({ error: "Only finished workouts can be sent. Finish this workout first." }, { status: 400 });
    }

    const recipient = recipientMemberId
      ? (db
          .prepare(
            `SELECT member_id, email, first_name, last_name, preferred_name
             FROM members WHERE member_id = ? AND TRIM(COALESCE(email, '')) != '' LIMIT 1`
          )
          .get(recipientMemberId) as
          | {
              member_id: string;
              email: string | null;
              first_name: string | null;
              last_name: string | null;
              preferred_name: string | null;
            }
          | undefined)
      : (db
          .prepare(
            `SELECT member_id, email, first_name, last_name, preferred_name
             FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1`
          )
          .get(recipientEmail) as
          | {
              member_id: string;
              email: string | null;
              first_name: string | null;
              last_name: string | null;
              preferred_name: string | null;
            }
          | undefined);
    if (!recipient) {
      db.close();
      return NextResponse.json({ error: "No member found with that name or email" }, { status: 404 });
    }
    if (recipient.member_id === senderId) {
      db.close();
      return NextResponse.json({ error: "You cannot send a workout to yourself" }, { status: 400 });
    }

    const wePragma = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
    const hasUseForMy1rm = wePragma.some((c) => c.name === "use_for_my_1rm");
    const hasExerciseNotes = wePragma.some((c) => c.name === "notes");
    const exerciseSelectFields = ["id", "type", "exercise_name", "sort_order", "exercise_id"];
    if (hasUseForMy1rm) exerciseSelectFields.push("use_for_my_1rm");
    if (hasExerciseNotes) exerciseSelectFields.push("notes");
    const exercises = db
      .prepare(`SELECT ${exerciseSelectFields.join(", ")} FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id`)
      .all(workoutId) as {
      id: number;
      type: string;
      exercise_name: string;
      sort_order: number;
      exercise_id: number | null;
      use_for_my_1rm?: number;
      notes?: string | null;
    }[];
    if (exercises.length === 0) {
      db.close();
      return NextResponse.json({ error: "This workout has no exercises to share" }, { status: 400 });
    }

    const setCols = db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[];
    const hasDropIndex = setCols.some((c) => c.name === "drop_index");
    const hasSetNotes = setCols.some((c) => c.name === "notes");

    /** exercise_id FK must point at a real exercises row; old workouts may reference deleted IDs. */
    const exerciseExists = db.prepare("SELECT 1 FROM exercises WHERE id = ?");

    const workoutName = workout.name?.trim() || null;
    const workoutCols = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
    const hasSharedBy = workoutCols.some((c) => c.name === "shared_by_member_id");
    const insertWorkout = hasSharedBy
      ? db.prepare(
          "INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, name, shared_by_member_id) VALUES (?, datetime('now'), datetime('now'), 0, ?, ?)"
        )
      : db.prepare("INSERT INTO workouts (member_id, started_at, finished_at, assigned_by_admin, name) VALUES (?, datetime('now'), datetime('now'), 0, ?)");

    let insertEx: Database.Statement<unknown[]>;
    if (hasUseForMy1rm && hasExerciseNotes) {
      insertEx = db.prepare(
        "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id, use_for_my_1rm, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasUseForMy1rm) {
      insertEx = db.prepare(
        "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id, use_for_my_1rm) VALUES (?, ?, ?, ?, ?, ?)"
      );
    } else if (hasExerciseNotes) {
      insertEx = db.prepare(
        "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id, notes) VALUES (?, ?, ?, ?, ?, ?)"
      );
    } else {
      insertEx = db.prepare(
        "INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)"
      );
    }

    let insertSet: Database.Statement<unknown[]>;
    if (hasDropIndex && hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasDropIndex) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else if (hasSetNotes) {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
    } else {
      insertSet = db.prepare(
        "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
      );
    }

    const workoutInsert = hasSharedBy
      ? insertWorkout.run(recipient.member_id, workoutName, senderId)
      : insertWorkout.run(recipient.member_id, workoutName);
    const newId = Number(workoutInsert.lastInsertRowid);
    if (!Number.isFinite(newId) || newId < 1) {
      db.close();
      return NextResponse.json({ error: "Failed to create workout copy" }, { status: 500 });
    }

    let setSel = "SELECT reps, weight_kg, time_seconds, distance_km, set_order";
    if (hasDropIndex) setSel += ", drop_index";
    if (hasSetNotes) setSel += ", notes";
    setSel += " FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_order, id";

    for (const ex of exercises) {
      const type = parseExerciseType(ex.type);
      const rawExId = ex.exercise_id != null && ex.exercise_id > 0 ? ex.exercise_id : null;
      const exerciseId =
        rawExId != null && exerciseExists.get(rawExId) != null ? rawExId : null;
      const useForMy1rm = hasUseForMy1rm && type === "lift" && exerciseId != null && (ex.use_for_my_1rm ?? 0) === 1;
      const exNotes = hasExerciseNotes ? (ex.notes ?? null) : null;
      let exResult: { lastInsertRowid: number };
      if (hasUseForMy1rm && hasExerciseNotes) {
        exResult = insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId, useForMy1rm ? 1 : 0, exNotes) as { lastInsertRowid: number };
      } else if (hasUseForMy1rm) {
        exResult = insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId, useForMy1rm ? 1 : 0) as { lastInsertRowid: number };
      } else if (hasExerciseNotes) {
        exResult = insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId, exNotes) as { lastInsertRowid: number };
      } else {
        exResult = insertEx.run(newId, type, ex.exercise_name, ex.sort_order, exerciseId) as { lastInsertRowid: number };
      }
      if (useForMy1rm && exerciseId != null) {
        db.prepare("INSERT OR REPLACE INTO member_1rm_settings (member_id, exercise_id) VALUES (?, ?)").run(recipient.member_id, exerciseId);
      }
      const newExId = Number(exResult.lastInsertRowid);
      const sets = db.prepare(setSel).all(ex.id) as {
        reps: number | null;
        weight_kg: number | null;
        time_seconds: number | null;
        distance_km: number | null;
        set_order: number;
        drop_index?: number;
        notes?: string | null;
      }[];
      for (const s of sets) {
        const di = hasDropIndex ? (s.drop_index != null ? s.drop_index : 0) : 0;
        const sn = hasSetNotes ? (s.notes ?? null) : null;
        if (hasDropIndex && hasSetNotes) {
          insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order, di, sn);
        } else if (hasDropIndex) {
          insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order, di);
        } else if (hasSetNotes) {
          insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order, sn);
        } else {
          insertSet.run(newExId, s.reps, s.weight_kg, s.time_seconds, s.distance_km, s.set_order);
        }
      }
    }

    db.close();
    const recipientLabel =
      String(recipient.preferred_name ?? "").trim() ||
      [recipient.first_name, recipient.last_name].filter(Boolean).join(" ").trim() ||
      String(recipient.email ?? "").trim();
    return NextResponse.json({
      ok: true,
      message: `Workout sent to ${recipientLabel}. They'll see it in their Workouts list and can repeat it.`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to send workout" }, { status: 500 });
  }
}
