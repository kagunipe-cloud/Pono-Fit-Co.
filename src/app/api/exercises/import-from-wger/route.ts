import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCanonicalPrimaryMuscles, getMuscleGroup, getMuscleGroupFromCategory } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WGER_BASE = "https://wger.de/api/v2";
const ENGLISH_LANG_ID = 2;

type WgerMuscle = { id: number; name: string; name_en?: string };
type WgerEquipment = { id: number; name: string };
type WgerCategory = { id: number; name: string };
type WgerTranslation = { id: number; name: string; language: number };
type WgerExerciseInfo = {
  id: number;
  category: WgerCategory;
  muscles: WgerMuscle[];
  muscles_secondary: WgerMuscle[];
  equipment: WgerEquipment[];
  translations: WgerTranslation[];
};

function muscleName(m: WgerMuscle): string {
  const s = (m.name_en ?? m.name ?? "").trim();
  return s || m.name || "";
}

/**
 * POST — fetch all exercises from wger (exerciseinfo, English) and import into our DB.
 * Duplicates (same name+type) are skipped. Adds many lifts including Romanian deadlifts etc.
 */
export async function POST() {
  try {
    const items: { name: string; type: "lift" | "cardio"; primary_muscles: string; secondary_muscles: string; equipment: string; muscle_group: string }[] = [];
    let url: string | null = `${WGER_BASE}/exerciseinfo/?language=${ENGLISH_LANG_ID}&limit=100`;

    while (url) {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`wger fetch failed: ${res.status}`);
      const data = (await res.json()) as { next: string | null; results: WgerExerciseInfo[] };
      const results = data.results ?? [];

      for (const ex of results) {
        const enTranslation = ex.translations?.find((t) => t.language === ENGLISH_LANG_ID) ?? ex.translations?.[0];
        const name = (enTranslation?.name ?? "").trim();
        if (!name) continue;

        const categoryName = (ex.category?.name ?? "").toLowerCase();
        const type: "lift" | "cardio" = categoryName === "cardio" ? "cardio" : "lift";

        let primary_muscles = (ex.muscles ?? []).map(muscleName).filter(Boolean).join(", ");
        const canonical = getCanonicalPrimaryMuscles(name);
        if (canonical) primary_muscles = canonical;
        const secondary_muscles = (ex.muscles_secondary ?? []).map(muscleName).filter(Boolean).join(", ");
        const equipment = (ex.equipment ?? []).map((e) => e.name?.trim()).filter(Boolean).join(", ");
        let muscle_group = getMuscleGroup(primary_muscles || undefined, name);
        // wger: when muscles don't match our map, use category (e.g. "Chest", "Legs") so we don't get "core" for everything
        if (muscle_group === "core") {
          const fromCategory = getMuscleGroupFromCategory(ex.category?.name);
          if (fromCategory) muscle_group = fromCategory;
        }

        items.push({ name, type, primary_muscles, secondary_muscles, equipment, muscle_group });
      }

      url = data.next ?? null;
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group) VALUES (?, ?, ?, ?, ?, ?)"
    );
    let added = 0;
    for (const it of items) {
      const r = insert.run(it.name, it.type, it.primary_muscles, it.secondary_muscles, it.equipment, it.muscle_group);
      if (r.changes > 0) added++;
    }
    db.close();

    return NextResponse.json({ added, total: items.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Import from wger failed" }, { status: 500 });
  }
}
