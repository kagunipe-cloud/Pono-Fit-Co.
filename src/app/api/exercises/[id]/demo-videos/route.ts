import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";
import {
  cacheKeyForExercise,
  evaluateCacheForResponse,
  getCachedDemoVideos,
  isRefreshLocked,
  refreshExerciseDemoVideos,
  validateCachedDemoVideos,
} from "@/lib/exercise-demo-videos";

export const dynamic = "force-dynamic";

function discoveryConfigured(): boolean {
  return Boolean(
    process.env.SERPER_API_KEY?.trim() || process.env.YOUTUBE_API_KEY?.trim()
  );
}

/** GET — cached YouTube form demos (member). Fast path; refresh runs in background via `after()`. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id) || id < 1) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    if (!discoveryConfigured()) {
      return NextResponse.json({
        videos: [],
        status: "unavailable",
        cached: false,
        refreshing: false,
        message: "Video search is not configured on the server.",
      });
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const exercise = db
      .prepare("SELECT id, name, type FROM exercises WHERE id = ?")
      .get(id) as { id: number; name: string; type: string } | undefined;
    if (!exercise) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const cacheKey = cacheKeyForExercise(exercise.id, exercise.name, exercise.type);
    const cached = getCachedDemoVideos(db, cacheKey);
    const locked = isRefreshLocked(db, cacheKey);
    const { needsFullRefresh, needsValidation, needsStaleRediscover, showVideos } =
      evaluateCacheForResponse(cached);

    const hasVideos = showVideos.length > 0;
    const noCache = cached == null;

    const shouldBackgroundRefresh =
      !locked &&
      (noCache ||
        needsFullRefresh ||
        needsStaleRediscover ||
        (needsValidation && hasVideos));

    if (shouldBackgroundRefresh) {
      const exerciseId = exercise.id;
      const exerciseName = exercise.name;
      const exerciseType = exercise.type;
      after(async () => {
        const bg = getDb();
        try {
          ensureWorkoutTables(bg);
          const key = cacheKeyForExercise(exerciseId, exerciseName, exerciseType);
          if (noCache || needsFullRefresh || needsStaleRediscover) {
            await refreshExerciseDemoVideos(bg, key, exerciseId, exerciseName);
          } else if (needsValidation) {
            const validated = await validateCachedDemoVideos(bg, key);
            if (validated.length === 0) {
              await refreshExerciseDemoVideos(bg, key, exerciseId, exerciseName);
            }
          }
        } catch (e) {
          console.error("[demo-videos] background job", e);
        } finally {
          bg.close();
        }
      });
    }

    db.close();

    let status: "ready" | "pending" | "unavailable" = "ready";
    if (!hasVideos && (noCache || locked || shouldBackgroundRefresh)) {
      status = "pending";
    }

    return NextResponse.json({
      videos: showVideos,
      status,
      cached: cached != null && hasVideos,
      refreshing: status === "pending",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load demo videos" }, { status: 500 });
  }
}
