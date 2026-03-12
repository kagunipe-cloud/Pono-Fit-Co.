import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const EXERCISE_IMAGES_DIR = path.join(DATA_DIR, "exercise-images");

/** GET — serve exercise image from data/exercise-images/ */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureWorkoutTables(db);
    const row = db.prepare("SELECT image_path FROM exercises WHERE id = ?").get(id) as { image_path: string | null } | undefined;
    db.close();

    if (!row || !row.image_path?.trim()) {
      return NextResponse.json({ error: "No image" }, { status: 404 });
    }

    // image_path is relative to data/, e.g. "exercise-images/3_4_Sit-Up-0.jpg"
    const safePath = path.normalize(row.image_path).replace(/^(\.\.(\/|\\|$))+/, "");
    const fullPath = path.join(DATA_DIR, safePath);

    if (!fullPath.startsWith(EXERCISE_IMAGES_DIR)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const buf = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType =
      ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";

    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to serve image" }, { status: 500 });
  }
}
