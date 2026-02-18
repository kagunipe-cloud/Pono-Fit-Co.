import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCanonicalPrimaryMuscles, getMuscleGroup, getMuscleGroupFromCategory, MUSCLE_GROUP_LABELS } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** Parse one CSV line respecting quoted fields (commas inside "..." stay one cell). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        cell += c;
      }
    } else if (c === ",") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  out.push(cell.trim());
  return out;
}

/** Split CSV text into logical lines (newlines inside quoted fields do not split). */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/**
 * POST — bulk import exercises.
 * Body: { exercises: [ ... ] } or array (free-exercise-db / wger), or { csv: "..." } for pasted CSV.
 * CSV should have a header row. Recognized columns: Exercise Name / Name / Title, Type, Target_Muscles / Target, Synergist_Muscles / Synergist, Equipment.
 * Duplicates (same name+type) are skipped.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 400 });
    }
    type ExerciseItem = { name: string; type: "lift" | "cardio"; primary_muscles?: string; secondary_muscles?: string; equipment?: string; muscle_group?: string; instructions?: string };
    const body = await request.json().catch(() => ({}));
    let items: ExerciseItem[] = [];

    if (typeof body.csv === "string" && body.csv.trim()) {
      const lines = splitCsvLines(body.csv.trim());
      const headerLine = lines[0] ?? "";
      const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
      const nameIdx = headers.findIndex((h) => h === "name" || h === "title" || h === "exercise name" || h === "exercise");
      const typeIdx = headers.findIndex((h) => h === "type");
      const targetIdx = headers.findIndex((h) => h === "target muscle" || h === "target_muscle" || (/\btarget\b/.test(h) && /\bmuscle\b/.test(h)) || (/\btarget\b/.test(h) && !/synergist/.test(h)));
      const synergistIdx = headers.findIndex((h) => /synergistic/.test(h) || /synergist/.test(h));
      const muscleGroupIdx = headers.findIndex((h) => h === "muscle group" || h === "muscle_group");
      const equipmentIdx = headers.findIndex((h) => h === "equipment");
      const instructionsIdx = headers.findIndex((h) => h === "instructions");
      const seenKey = new Set<string>();
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCsvLine(lines[i]);
        const name = (parts[nameIdx ?? 0] ?? "").trim().replace(/^"|"$/g, "").replace(/\s*,\s*$/, "");
        if (!name) continue;
        const typeRaw = (parts[typeIdx ?? 1] ?? "lift").replace(/^"|"$/g, "").toLowerCase();
        const type = typeRaw === "cardio" ? "cardio" : "lift";
        const key = `${name.toLowerCase()}|${type}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const primary_muscles = (targetIdx >= 0 ? (parts[targetIdx] ?? "").trim().replace(/^"|"$/g, "") : "").replace(/\s*,\s*$/, "");
        const secondary_muscles = (synergistIdx >= 0 ? (parts[synergistIdx] ?? "").trim().replace(/^"|"$/g, "") : "").replace(/\s*,\s*$/, "");
        const equipment = (equipmentIdx >= 0 ? (parts[equipmentIdx] ?? "").trim().replace(/^"|"$/g, "") : "").replace(/\s*,\s*$/, "");
        const muscle_group_raw = muscleGroupIdx >= 0 ? (parts[muscleGroupIdx] ?? "").trim().replace(/^"|"$/g, "").toLowerCase() : "";
        const muscle_group = muscle_group_raw && MUSCLE_GROUP_LABELS.includes(muscle_group_raw as typeof MUSCLE_GROUP_LABELS[number])
          ? muscle_group_raw
          : getMuscleGroup(primary_muscles || undefined, name);
        const instructions = instructionsIdx >= 0 ? (parts[instructionsIdx] ?? "").trim().replace(/^"|"$/g, "") : "";
        items.push({ name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions: instructions || undefined });
      }
    } else {
      const list = Array.isArray(body.exercises) ? body.exercises : Array.isArray(body) ? body : [];
      if (list.length === 0 && !Array.isArray(body.exercises) && !Array.isArray(body)) {
        return NextResponse.json({ error: "Body must be { exercises: [ ... ] }, an array, or { csv: \"...\" }" }, { status: 400 });
      }
      for (const row of list) {
        const name = String(row.name ?? row.title ?? "").trim();
        if (!name) continue;
        let type: "lift" | "cardio" = "lift";
        if (row.type === "cardio") type = "cardio";
        else if (row.category) {
          const cat = String(row.category).toLowerCase();
          type = cat === "cardio" ? "cardio" : "lift";
        }
        let primary_muscles = Array.isArray(row.primaryMuscles) ? row.primaryMuscles.join(", ") : (row.primary_muscles != null ? String(row.primary_muscles) : row.target != null ? String(row.target) : "");
        const canonical = getCanonicalPrimaryMuscles(name);
        if (canonical) primary_muscles = canonical;
        const secondary_muscles = Array.isArray(row.secondaryMuscles) ? row.secondaryMuscles.join(", ") : (row.secondary_muscles != null ? String(row.secondary_muscles) : "");
        const equipment = row.equipment != null ? String(row.equipment).trim() : "";
        let muscle_group: string | null = null;
        const rawGroup = row.muscle_group != null ? String(row.muscle_group).trim().toLowerCase() : "";
        if (rawGroup && MUSCLE_GROUP_LABELS.includes(rawGroup as typeof MUSCLE_GROUP_LABELS[number])) muscle_group = rawGroup;
        if (!muscle_group && row.bodyPart != null) {
          const fromCat = getMuscleGroupFromCategory(row.bodyPart);
          muscle_group = fromCat ?? null;
        }
        if (!muscle_group) muscle_group = getMuscleGroup(primary_muscles || undefined, name);
        const instructionsArr = Array.isArray(row.instructions) ? row.instructions : row.instructions != null ? [String(row.instructions)] : [];
        const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";
        items.push({ name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions: instructions || undefined });
      }
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    let added = 0;
    for (const it of items) {
      const r = insert.run(
        it.name,
        it.type,
        it.primary_muscles ?? "",
        it.secondary_muscles ?? "",
        it.equipment ?? "",
        it.muscle_group ?? "core",
        it.instructions ?? ""
      );
      if (r.changes > 0) added++;
    }
    db.close();
    return NextResponse.json({ added, total: items.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to import exercises" }, { status: 500 });
  }
}
