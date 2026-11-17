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
  splitDemoVideosByFormat,
  isExerciseDemoAutoRefreshEnabled,
  validateCachedDemoVideos,
} from "@/lib/exercise-demo-videos";

export const dynamic = "force-dynamic";
/** First-time lookup runs Serper/YouTube/Gemini in-request (~2–15s). */
export const maxDuration = 60;

function discoveryConfigured(): boolean {
  return Boolean(
    process.env.SERPER_API_KEY?.trim() || process.env.YOUTUBE_API_KEY?.trim()
  );
}

/** GET — YouTube form demos (member). Cached; refresh on miss when auto-refresh is enabled (default on). */
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
    let cached = getCachedDemoVideos(db, cacheKey);
    const locked = isRefreshLocked(db, cacheKey);
    let evalResult = evaluateCacheForResponse(cached);
    let showVideos = evalResult.showVideos;
    let hasVideos = showVideos.length > 0;
    const noCache = cached == null;
    const emptyCache = cached != null && !hasVideos;

    const autoRefresh = isExerciseDemoAutoRefreshEnabled();
    const shouldRefresh =
      autoRefresh &&
      !locked &&
      (noCache ||
        evalResult.needsFullRefresh ||
        evalResult.needsStaleRediscover ||
        emptyCache ||
        (evalResult.needsValidation && hasVideos));

    let didSyncRefresh = false;
    if (shouldRefresh && !hasVideos) {
      await refreshExerciseDemoVideos(db, cacheKey, exercise.id, exercise.name);
      didSyncRefresh = true;
      cached = getCachedDemoVideos(db, cacheKey);
      evalResult = evaluateCacheForResponse(cached);
      showVideos = evalResult.showVideos;
      hasVideos = showVideos.length > 0;
    } else if (shouldRefresh && hasVideos) {
      const exerciseId = exercise.id;
      const exerciseName = exercise.name;
      const exerciseType = exercise.type;
      after(async () => {
        const bg = getDb();
        try {
          ensureWorkoutTables(bg);
          const key = cacheKeyForExercise(exerciseId, exerciseName, exerciseType);
          if (evalResult.needsStaleRediscover || evalResult.needsFullRefresh) {
            await refreshExerciseDemoVideos(bg, key, exerciseId, exerciseName);
          } else if (evalResult.needsValidation) {
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
    if (!hasVideos && autoRefresh && locked && (noCache || emptyCache)) {
      status = "pending";
    }

    const split = splitDemoVideosByFormat(showVideos);

    let message: string | undefined;
    if (!hasVideos && !autoRefresh) {
      message =
        "No cached videos for this exercise yet. Your gym can add them during a scheduled catalog warm-up.";
    } else if (!hasVideos && autoRefresh && (didSyncRefresh || locked)) {
      message =
        "We could not find vetted form videos for this exercise right now. Try again later or ask a trainer.";
    }

    return NextResponse.json({
      videos: split.ordered,
      shorts: split.shorts,
      full_length: split.full_length,
      status,
      cached: cached != null && hasVideos,
      refreshing: status === "pending",
      message,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load demo videos" }, { status: 500 });
  }
}
