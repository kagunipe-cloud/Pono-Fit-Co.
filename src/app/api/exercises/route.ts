import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET ?q=...&type=lift|cardio — search/autocomplete for official exercises (e.g. member typing in workout). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const type = searchParams.get("type"); // 'lift' | 'cardio' | omit for both

    const db = getDb();
    ensureWorkoutTables(db);

    let sql = "SELECT id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions FROM exercises WHERE 1=1";
    const params: (string | number)[] = [];
    if (type === "lift" || type === "cardio") {
      sql += " AND type = ?";
      params.push(type);
    }
    if (q.length > 0) {
      sql += " AND name LIKE ?";
      params.push(`%${q}%`);
    }
    sql += " ORDER BY name LIMIT " + (q.length > 0 ? 25 : 10000);

    const rows = db.prepare(sql).all(...params) as {
      id: number;
      name: string;
      type: string;
      primary_muscles?: string | null;
      secondary_muscles?: string | null;
      equipment?: string | null;
      muscle_group?: string | null;
      instructions?: string | null;
    }[];
    db.close();

    // Deduplicate only when searching (member autocomplete); admin list shows all exercises.
    let rowsToUse = rows;
    if (q.length > 0) {
      const normalized = (s: string) => s.trim().toLowerCase();
      const sortedByLength = [...rows].sort((a, b) => normalized(a.name).length - normalized(b.name).length);
      const deduped: typeof rows = [];
      for (const r of sortedByLength) {
        const n = normalized(r.name);
        const isDuplicate = deduped.some((d) => {
          const dn = normalized(d.name);
          if (d.type !== r.type) return false;
          if (n === dn) return true;
          if (n.includes(dn) || dn.includes(n)) return true;
          return false;
        });
        if (!isDuplicate) deduped.push(r);
      }
      rowsToUse = deduped.length > 0 ? deduped : rows;
    }

    // Derive muscle_group for rows that don't have it; apply name-based overrides (e.g. Bulgarian split squat = legs)
    const out = rowsToUse.map((r) => {
      const canonicalMuscles = getCanonicalPrimaryMuscles(r.name);
      const primary_muscles = canonicalMuscles ?? r.primary_muscles ?? "";
      const muscle_group = r.muscle_group && r.muscle_group.trim() ? r.muscle_group : getMuscleGroup(primary_muscles, r.name);
      return { ...r, primary_muscles, muscle_group };
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to search exercises" }, { status: 500 });
  }
}

/** POST { name, type: 'lift'|'cardio', primary_muscles?, secondary_muscles?, equipment? } — add one exercise (admin/seed). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const type = body.type === "cardio" ? "cardio" : "lift";
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const primary_muscles = body.primary_muscles != null ? String(body.primary_muscles) : "";
    const secondary_muscles = body.secondary_muscles != null ? String(body.secondary_muscles) : "";
    const equipment = body.equipment != null ? String(body.equipment) : "";
    const muscle_group = body.muscle_group && String(body.muscle_group).trim() ? String(body.muscle_group).trim() : getMuscleGroup(primary_muscles);
    const instructionsArr = Array.isArray(body.instructions) ? body.instructions : body.instructions != null ? [String(body.instructions)] : [];
    const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";

    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM exercises WHERE name = ? AND type = ?").get(name, type);
    if (existing) {
      db.close();
      return NextResponse.json((existing as { id: number }).id);
    }
    const result = db
      .prepare(
        "INSERT INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions);
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add exercise" }, { status: 500 });
  }
}
