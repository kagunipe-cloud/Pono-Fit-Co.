import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getDb } from "@/lib/db";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts";
import { normalizeForMatch } from "@/lib/exercise-name-normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FREE_EXERCISE_DB_JSON = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const FREE_EXERCISE_DB_IMAGES_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const DATA_DIR = path.join(process.cwd(), "data");
const EXERCISE_IMAGES_DIR = path.join(DATA_DIR, "exercise-images");

type FreeDbExercise = {
  id?: string;
  name: string;
  force?: string;
  level?: string;
  mechanic?: string;
  equipment?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
  images?: string[];
};

function toSlug(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[/\\?*]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** POST — fetch free-exercise-db JSON, download images, import exercises. */
export async function POST() {
  try {
    if (!fs.existsSync(EXERCISE_IMAGES_DIR)) {
      fs.mkdirSync(EXERCISE_IMAGES_DIR, { recursive: true });
    }

    const res = await fetch(FREE_EXERCISE_DB_JSON);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
    const data = (await res.json()) as FreeDbExercise[];
    const list = Array.isArray(data) ? data : [];

    const db = getDb();
    ensureWorkoutTables(db);

    // Build map of normalized(name)|type -> our exercise (prefer one without image for backfill)
    const ourExercises = db.prepare("SELECT id, name, type, image_path FROM exercises").all() as {
      id: number;
      name: string;
      type: string;
      image_path: string | null;
    }[];
    const ourByNormalized = new Map<string, { id: number; name: string; type: string; image_path: string | null }>();
    for (const row of ourExercises) {
      const key = `${normalizeForMatch(row.name)}|${row.type}`;
      const existing = ourByNormalized.get(key);
      const preferThis = !existing || (!row.image_path?.trim() && existing.image_path?.trim());
      if (preferThis) ourByNormalized.set(key, row);
    }

    const insert = db.prepare(
      "INSERT OR IGNORE INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateImageById = db.prepare("UPDATE exercises SET image_path = ? WHERE id = ?");

    let added = 0;
    let imagesDownloaded = 0;
    let imagesBackfilled = 0;

    for (const ex of list) {
      const name = (ex.name ?? "").trim();
      if (!name) continue;

      const categoryName = (ex.category ?? "").toLowerCase();
      const type: "lift" | "cardio" = categoryName === "cardio" ? "cardio" : "lift";

      const primary_muscles = Array.isArray(ex.primaryMuscles) ? ex.primaryMuscles.join(", ") : "";
      const canonical = getCanonicalPrimaryMuscles(name);
      const primaryFinal = canonical ?? primary_muscles;
      const secondary_muscles = Array.isArray(ex.secondaryMuscles) ? ex.secondaryMuscles.join(", ") : "";
      const equipment = ex.equipment != null ? String(ex.equipment).trim() : "";
      const muscle_group = getMuscleGroup(primaryFinal || undefined, name);
      const instructionsArr = Array.isArray(ex.instructions) ? ex.instructions : [];
      const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";

      let image_path: string | null = null;
      const firstImage = ex.images?.[0];
      if (firstImage && typeof firstImage === "string") {
        const imageUrl = firstImage.startsWith("http") ? firstImage : FREE_EXERCISE_DB_IMAGES_BASE + firstImage;
        const fid = (ex.id ?? toSlug(name)).replace(/[/\\]/g, "_");
        const ext = path.extname(firstImage) || ".jpg";
        const localName = `${fid}${ext}`;
        const localPath = path.join(EXERCISE_IMAGES_DIR, localName);
        const storedPath = `exercise-images/${localName}`;

        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            fs.writeFileSync(localPath, buf);
            image_path = storedPath;
            imagesDownloaded++;
          }
        } catch {
          /* skip image on failure */
        }
      }

      const exactMatch = ourExercises.find((r) => r.name === name && r.type === type);
      const normalizedKey = `${normalizeForMatch(name)}|${type}`;
      const normalizedMatch = ourByNormalized.get(normalizedKey);

      const ourMatch = exactMatch ?? normalizedMatch;
      if (ourMatch && image_path && !ourMatch.image_path?.trim()) {
        updateImageById.run(image_path, ourMatch.id);
        imagesBackfilled++;
      }

      if (!ourMatch) {
        const r = insert.run(
          name,
          type,
          primaryFinal,
          secondary_muscles,
          equipment,
          muscle_group,
          instructions,
          image_path ?? ""
        );
        if (r.changes > 0) added++;
      }
    }

    db.close();
    return NextResponse.json({
      added,
      total: list.length,
      imagesDownloaded,
      imagesBackfilled,
      message: `Added ${added} exercises, ${imagesDownloaded} images downloaded, ${imagesBackfilled} images backfilled for existing exercises.`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import from free-exercise-db failed" },
      { status: 500 }
    );
  }
}
