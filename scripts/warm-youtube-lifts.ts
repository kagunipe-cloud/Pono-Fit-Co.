/**
 * Pre-fetch Video instructions cache for lifts (Shorts + full length + YouTube view counts for muscle map sort).
 *
 * Usage:
 *   npm run warm-youtube-lifts
 *   npm run warm-youtube-lifts -- --limit=20
 *   npm run warm-youtube-lifts -- --force --sleep=3000
 *
 * Railway Shell:
 *   cd /app && nohup npm run warm-youtube-lifts > /tmp/warm-youtube.log 2>&1 &
 */

import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { getDb } from "../src/lib/db";
import {
  CACHE_TTL_DAYS,
  EMPTY_CACHE_RETRY_DAYS,
  cacheKeyForExercise,
  ensureExerciseDemoVideoCacheTable,
  getCachedDemoVideos,
  isRefreshLocked,
  refreshExerciseDemoVideos,
  simplifyExerciseNameForVideoSearch,
} from "../src/lib/exercise-demo-videos";

type Row = { id: number; name: string; type: string };

function parseArgs(argv: string[]) {
  let limit = 0;
  let sleepMs = 3_500;
  let force = false;
  let typeFilter = "lift";

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) limit = Math.max(0, parseInt(arg.slice("--limit=".length), 10) || 0);
    if (arg.startsWith("--sleep=")) sleepMs = Math.max(0, parseInt(arg.slice("--sleep=".length), 10) || 0);
    if (arg.startsWith("--type=")) typeFilter = arg.slice("--type=".length).trim() || "lift";
    if (arg === "--force") force = true;
    if (arg === "--all-types") typeFilter = "all";
  }

  return { limit, sleepMs, force, typeFilter };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheAgeDays(fetchedAt: string): number {
  const ms = Date.parse(fetchedAt.includes("T") ? fetchedAt : fetchedAt.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return Infinity;
  return (Date.now() - ms) / 86_400_000;
}

function needsWarm(
  cacheKey: string,
  db: ReturnType<typeof getDb>,
  force: boolean
): { go: boolean; reason?: string } {
  if (force) return { go: true };
  if (isRefreshLocked(db, cacheKey)) return { go: false, reason: "refresh locked" };
  const cached = getCachedDemoVideos(db, cacheKey);
  if (!cached) return { go: true };
  if (cached.videos.length === 0 && cacheAgeDays(cached.fetched_at) > EMPTY_CACHE_RETRY_DAYS) return { go: true };
  if (cached.videos.length > 0 && cacheAgeDays(cached.fetched_at) > CACHE_TTL_DAYS) return { go: true };
  if (cached.videos.length > 0) return { go: false, reason: "fresh cache" };
  if (cacheAgeDays(cached.fetched_at) <= EMPTY_CACHE_RETRY_DAYS) return { go: false, reason: "recent empty try" };
  return { go: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const hasDiscovery =
    Boolean(process.env.SERPER_API_KEY?.trim()) || Boolean(process.env.YOUTUBE_API_KEY?.trim());
  if (!hasDiscovery) {
    console.error("Need SERPER_API_KEY and/or YOUTUBE_API_KEY.");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.warn("GEMINI_API_KEY missing — ranking falls back to heuristics (still works).");
  }
  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    console.warn("YOUTUBE_API_KEY missing — view counts / duration / validation will be weaker.");
  }

  const db = getDb();
  ensureExerciseDemoVideoCacheTable(db);

  let rows = db
    .prepare(`SELECT id, name, type FROM exercises ORDER BY name`)
    .all() as Row[];

  if (args.typeFilter !== "all") {
    rows = rows.filter((r) => r.type === args.typeFilter);
  }

  const queue = rows.filter((r) => needsWarm(cacheKeyForExercise(r.id, r.name, r.type), db, args.force).go);
  const toProcess = args.limit > 0 ? queue.slice(0, args.limit) : queue;

  console.log(
    `\nYouTube warm: ${toProcess.length} to run (${queue.length} need refresh, ${rows.length} ${args.typeFilter} in catalog).`
  );

  let ok = 0;
  let empty = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i]!;
    const key = cacheKeyForExercise(row.id, row.name, row.type);
    process.stdout.write(`[${i + 1}/${toProcess.length}] #${row.id} ${row.name} … `);
    try {
      const videos = await refreshExerciseDemoVideos(db, key, row.id, row.name);
      if (videos.length > 0) {
        const topViews = Math.max(...videos.map((v) => v.view_count ?? 0), 0);
        console.log(`${videos.length} video(s), top views ${topViews > 0 ? topViews.toLocaleString() : "—"}`);
        ok++;
      } else {
        const alt = simplifyExerciseNameForVideoSearch(row.name);
        console.log(
          alt.toLowerCase() !== row.name.trim().toLowerCase()
            ? `no vetted videos (searched base name “${alt}” too)`
            : "no vetted videos"
        );
        empty++;
      }
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : "unknown"}`);
      failed++;
    }
    if (args.sleepMs > 0 && i < toProcess.length - 1) await sleep(args.sleepMs);
  }

  let skippedCount = 0;
  if (!args.force) {
    for (const row of rows) {
      const key = cacheKeyForExercise(row.id, row.name, row.type);
      const { go } = needsWarm(key, db, false);
      if (!go) skippedCount++;
    }
  }

  db.close();
  console.log(
    `\nDone: ${ok} cached, ${empty} empty, ${failed} errors. (${skippedCount} already fresh — use --force to redo.)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});