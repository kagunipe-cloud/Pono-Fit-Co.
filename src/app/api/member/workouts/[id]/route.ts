import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getMemberIdFromSession } from "../../../../../lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";
import { applyMemberWorkoutFinishSideEffects } from "@/lib/workout-finish-side-effects";
import { resolveWorkoutOwnerMemberId } from "@/lib/member-workout-access";

export const dynamic = "force-dynamic";

async function getWorkoutWithExercises(db: ReturnType<typeof getDb>, workoutId: number, memberId: string) {
  const woCols = db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[];
  const hasName = woCols.some((c) => c.name === "name");
  const hasTrainer = woCols.some((c) => c.name === "assigned_by_trainer_member_id");
  const hasTrainerNotes = woCols.some((c) => c.name === "trainer_notes");
  const hasClientNotes = woCols.some((c) => c.name === "client_completion_notes");
  const hasSharedBy = woCols.some((c) => c.name === "shared_by_member_id");
  const cols = ["id", "member_id", "started_at", "finished_at", "source_workout_id", "assigned_by_admin"];
  if (hasName) cols.push("name");
  if (hasTrainer) cols.push("assigned_by_trainer_member_id");
  if (hasTrainerNotes) cols.push("trainer_notes");
  if (hasClientNotes) cols.push("client_completion_notes");
  if (hasSharedBy) cols.push("shared_by_member_id");
  const workout = db
    .prepare(`SELECT ${cols.join(", ")} FROM workouts WHERE id = ? AND member_id = ?`)
    .get(workoutId, memberId) as {
    id: number;
    member_id: string;
    started_at: string;
    finished_at: string | null;
    source_workout_id: number | null;
    assigned_by_admin: number;
    name?: string | null;
    assigned_by_trainer_member_id?: string | null;
    trainer_notes?: string | null;
    client_completion_notes?: string | null;
    shared_by_member_id?: string | null;
  } | undefined;
  if (!workout) return null;
  let shared_by_first_name: string | null = null;
  let shared_by_last_name: string | null = null;
  if (hasSharedBy && workout.shared_by_member_id?.trim()) {
    const sharer = db
      .prepare("SELECT first_name, last_name FROM members WHERE member_id = ?")
      .get(workout.shared_by_member_id.trim()) as { first_name: string | null; last_name: string | null } | undefined;
    shared_by_first_name = sharer?.first_name ?? null;
    shared_by_last_name = sharer?.last_name ?? null;
  }
  const exerciseTableCols = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
  const hasUseForMy1rm = exerciseTableCols.some((c) => c.name === "use_for_my_1rm");
  const hasExerciseNotes = exerciseTableCols.some((c) => c.name === "notes");
  const exerciseCols = ["id", "workout_id", "type", "exercise_name", "sort_order", "exercise_id"];
  if (hasUseForMy1rm) exerciseCols.push("use_for_my_1rm");
  if (hasExerciseNotes) exerciseCols.push("notes");
  const exercises = db
    .prepare(
      `SELECT ${exerciseCols.join(", ")} FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id`
    )
    .all(workoutId) as {
    id: number;
    workout_id: number;
    type: string;
    exercise_name: string;
    sort_order: number;
    exercise_id: number | null;
    use_for_my_1rm?: number;
    notes?: string | null;
  }[];
  const setColNames = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
  const hasDropIndex = setColNames.includes("drop_index");
  const hasSetNotes = setColNames.includes("notes");
  let setSelect = "id, reps, weight_kg, time_seconds, distance_km, set_order";
  if (hasDropIndex) setSelect += ", drop_index";
  if (hasSetNotes) setSelect += ", notes";
  const setsByExercise: Record<
    number,
    { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number; notes?: string | null }[]
  > = {};
  for (const ex of exercises) {
    const sets = db.prepare(`SELECT ${setSelect} FROM workout_sets WHERE workout_exercise_id = ? ORDER BY ${hasDropIndex ? "set_order, drop_index, id" : "set_order, id"}`).all(ex.id) as {
      id: number;
      reps: number | null;
      weight_kg: number | null;
      time_seconds: number | null;
      distance_km: number | null;
      set_order: number;
      drop_index?: number;
      notes?: string | null;
    }[];
    setsByExercise[ex.id] = sets;
  }
  return {
    ...workout,
    ...(hasSharedBy ? { shared_by_first_name, shared_by_last_name } : {}),
    exercises: exercises.map((e) => ({ ...e, sets: setsByExercise[e.id] ?? [] })),
  };
}

function clientDisplayName(row: {
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const preferred = String(row.preferred_name ?? "").trim();
  if (preferred) return preferred;
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Member";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionMemberId = await getMemberIdFromSession();
    if (!sessionMemberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const access = resolveWorkoutOwnerMemberId(db, sessionMemberId, id);
    if (!access.ok) {
      db.close();
      return NextResponse.json({ error: access.error === "forbidden" ? "Forbidden" : "Not found" }, { status: access.error === "forbidden" ? 403 : 404 });
    }
    const ownerMemberId = access.ownerMemberId;
    const workout = await getWorkoutWithExercises(db, id, ownerMemberId);
    let client_display_name: string | null = null;
    if (sessionMemberId !== ownerMemberId) {
      const client = db
        .prepare("SELECT first_name, last_name, preferred_name FROM members WHERE member_id = ?")
        .get(ownerMemberId) as { first_name: string | null; last_name: string | null; preferred_name: string | null } | undefined;
      client_display_name = client ? clientDisplayName(client) : null;
    }
    db.close();
    if (!workout) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ...workout,
      is_recording_for_client: sessionMemberId !== ownerMemberId,
      client_display_name,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch workout" }, { status: 500 });
  }
}

/** Finish workout: set finished_at */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionMemberId = await getMemberIdFromSession();
    if (!sessionMemberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = getDb();
    ensureWorkoutTables(db);
    const access = resolveWorkoutOwnerMemberId(db, sessionMemberId, id);
    if (!access.ok) {
      db.close();
      return NextResponse.json({ error: access.error === "forbidden" ? "Forbidden" : "Not found" }, { status: access.error === "forbidden" ? 403 : 404 });
    }
    const memberId = access.ownerMemberId;
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const hasName = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "name");
    if (body.finish === true) {
      db.prepare("UPDATE workouts SET finished_at = datetime('now') WHERE id = ?").run(id);
      const clientNotes = typeof body.client_completion_notes === "string" ? body.client_completion_notes.trim() || null : null;
      const hasClientNotesCol = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).some((c) => c.name === "client_completion_notes");
      if (hasClientNotesCol && clientNotes !== undefined) {
        db.prepare("UPDATE workouts SET client_completion_notes = ? WHERE id = ? AND member_id = ?").run(clientNotes, id, memberId);
      }
      applyMemberWorkoutFinishSideEffects(db, id, memberId);
    }
    if (hasName && (typeof body.name === "string" || body.name === null)) {
      const name = body.name === null ? null : (String(body.name).trim() || null);
      db.prepare("UPDATE workouts SET name = ? WHERE id = ? AND member_id = ?").run(name, id, memberId);
    }
    db.close();
    const outDb = getDb();
    const workout = await getWorkoutWithExercises(outDb, id, memberId);
    outDb.close();
    return NextResponse.json(workout ?? {});
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

/** Delete workout (and its exercises/sets via cascade). Member must own the workout. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionMemberId = await getMemberIdFromSession();
    if (!sessionMemberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const access = resolveWorkoutOwnerMemberId(db, sessionMemberId, id);
    if (!access.ok) {
      db.close();
      return NextResponse.json({ error: access.error === "forbidden" ? "Forbidden" : "Not found" }, { status: access.error === "forbidden" ? 403 : 404 });
    }
    const memberId = access.ownerMemberId;
    const existing = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(id, memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const exerciseIds = db.prepare("SELECT id FROM workout_exercises WHERE workout_id = ?").all(id) as { id: number }[];
    for (const { id: exId } of exerciseIds) {
      db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id = ?").run(exId);
    }
    db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(id);
    db.prepare("DELETE FROM workouts WHERE id = ? AND member_id = ?").run(id, memberId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete workout" }, { status: 500 });
  }
}
