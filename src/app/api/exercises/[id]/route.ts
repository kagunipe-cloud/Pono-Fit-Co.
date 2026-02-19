import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET — fetch one exercise by id (e.g. for "Need Instructions?" in member workout). Returns name, type, instructions. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const row = db.prepare(
      "SELECT id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions FROM exercises WHERE id = ?"
    ).get(id) as { id: number; name: string; type: string; primary_muscles: string | null; secondary_muscles: string | null; equipment: string | null; muscle_group: string | null; instructions: string | null } | undefined;
    db.close();

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let instructions: string[] = [];
    if (row.instructions && row.instructions.trim()) {
      try {
        const parsed = JSON.parse(row.instructions);
        instructions = Array.isArray(parsed) ? parsed.map(String) : [String(row.instructions)];
      } catch {
        instructions = [row.instructions];
      }
    }

    return NextResponse.json({
      id: row.id,
      name: row.name,
      type: row.type,
      primary_muscles: row.primary_muscles,
      secondary_muscles: row.secondary_muscles,
      equipment: row.equipment,
      muscle_group: row.muscle_group,
      instructions,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch exercise" }, { status: 500 });
  }
}

/** PATCH — update exercise (admin). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const name = (body.name ?? "").trim();
    const type = body.type === "cardio" ? "cardio" : "lift";
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const primary_muscles = body.primary_muscles != null ? String(body.primary_muscles).trim() || null : null;
    const secondary_muscles = body.secondary_muscles != null ? String(body.secondary_muscles).trim() || null : null;
    const equipment = body.equipment != null ? String(body.equipment).trim() || null : null;
    const muscle_group = body.muscle_group != null ? String(body.muscle_group).trim() || null : null;
    let instructions: string | null | undefined = undefined;
    if (body.instructions !== undefined) {
      if (Array.isArray(body.instructions)) {
        instructions = body.instructions.length > 0 ? JSON.stringify(body.instructions.map(String)) : null;
      } else if (typeof body.instructions === "string") {
        const lines = body.instructions.split("\n").map((s: string) => s.trim()).filter(Boolean);
        instructions = lines.length > 0 ? JSON.stringify(lines) : null;
      }
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM exercises WHERE id = ?").get(id);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (instructions !== undefined) {
      db.prepare(
        "UPDATE exercises SET name = ?, type = ?, primary_muscles = ?, secondary_muscles = ?, equipment = ?, muscle_group = ?, instructions = ? WHERE id = ?"
      ).run(name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions, id);
    } else {
      db.prepare(
        "UPDATE exercises SET name = ?, type = ?, primary_muscles = ?, secondary_muscles = ?, equipment = ?, muscle_group = ? WHERE id = ?"
      ).run(name, type, primary_muscles, secondary_muscles, equipment, muscle_group, id);
    }
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update exercise" }, { status: 500 });
  }
}
