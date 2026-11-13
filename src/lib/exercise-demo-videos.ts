/**
 * Discover, rank, validate, and cache third-party YouTube form demos for exercises.
 * Discovery: Serper (preferred) or YouTube search API. Ranking: Gemini on fixed candidates + heuristics.
 */

import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

const SERPER_BASE = "https://google.serper.dev";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
const GEMINI_MODEL =
  process.env.GEMINI_EXERCISE_MODEL?.trim() ||
  process.env.GEMINI_MACRO_MODEL?.trim() ||
  "gemini-2.5-flash";

export const CACHE_TTL_DAYS = 60;
export const VALIDATE_INTERVAL_DAYS = 7;
export const MAX_VIDEOS = 3;
const REFRESH_LOCK_MINUTES = 3;
const CACHE_MAX_ROWS = 5000;

export type ExerciseDemoVideo = {
  video_id: string;
  url: string;
  title: string;
  channel_title: string;
  tier: "A" | "B";
};

type Candidate = {
  video_id: string;
  url: string;
  title: string;
  channel_title: string;
  description: string;
};

type CacheRow = {
  cache_key: string;
  exercise_id: number | null;
  exercise_name: string;
  videos_json: string;
  fetched_at: string;
  validated_at: string | null;
  refresh_lock_until: string | null;
};

export function ensureExerciseDemoVideoCacheTable(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exercise_demo_video_cache (
      cache_key TEXT PRIMARY KEY,
      exercise_id INTEGER,
      exercise_name TEXT NOT NULL,
      videos_json TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      validated_at TEXT,
      refresh_lock_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exercise_demo_video_cache_exercise_id ON exercise_demo_video_cache(exercise_id);
  `);
}

function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cacheKeyForExercise(exerciseId: number | null, exerciseName: string, type?: string): string {
  if (exerciseId != null && exerciseId > 0) return `id:${exerciseId}`;
  const t = type?.trim().toLowerCase() || "lift";
  return `name:${normalizeExerciseName(exerciseName)}|${t}`;
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso?.trim()) return 0;
  const ms = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : 0;
}

function daysSince(iso: string | null | undefined): number {
  const ms = parseIsoMs(iso);
  if (!ms) return Infinity;
  return (Date.now() - ms) / 86_400_000;
}

export function parseYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (shorts) return shorts[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const CLICKBAIT_TITLE =
  /\b(world\s*record|insane|strongest|heaviest|\d{3,}\s*(lbs?|pounds?|kg|kilos?)|vs\.?\s|challenge|ego|pr\b|personal\s+record|montage|fails?\b|compilation)\b/i;

const FORM_BOOST =
  /\b(form|technique|how\s+to|tutorial|proper(ly)?|common\s+mistakes?|beginner|step\s+by\s+step|coaching|cue)\b/i;

const CRED_BOOST =
  /\b(dpt\b|physical\s+therapist|physio|physiotherapist|cscs|exercise\s+physiologist|acsm|nsca|doctor|clinic|university)\b/i;

function heuristicScore(c: Candidate): { score: number; tier: "A" | "B" } {
  const text = `${c.title} ${c.channel_title} ${c.description}`.toLowerCase();
  let score = 0;
  if (FORM_BOOST.test(text)) score += 4;
  if (CRED_BOOST.test(text)) score += 5;
  if (CLICKBAIT_TITLE.test(c.title)) score -= 8;
  if (/\bshorts?\b/i.test(c.title)) score -= 2;
  const tier: "A" | "B" = CRED_BOOST.test(text) ? "A" : "B";
  return { score, tier };
}

function rankHeuristic(candidates: Candidate[]): ExerciseDemoVideo[] {
  const scored = candidates
    .map((c) => {
      const { score, tier } = heuristicScore(c);
      return { c, score, tier };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  const strict = scored.filter((x) => x.tier === "A" && x.score >= 3);
  const pool = strict.length > 0 ? strict : scored.filter((x) => x.tier === "A");
  const chosen = (pool.length > 0 ? pool : scored).slice(0, MAX_VIDEOS);

  return chosen.map(({ c, tier }) => ({
    video_id: c.video_id,
    url: c.url,
    title: c.title,
    channel_title: c.channel_title,
    tier,
  }));
}

const RANK_JSON_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          candidate_index: { type: "integer", description: "0-based index into the CANDIDATES list" },
          tier: { type: "string", enum: ["A", "B"] },
          reject: { type: "boolean", description: "true if unsuitable for form instruction" },
        },
        required: ["candidate_index", "tier", "reject"],
      },
    },
  },
  required: ["picks"],
} as const;

async function rankWithGemini(exerciseName: string, candidates: Candidate[]): Promise<ExerciseDemoVideo[] | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || candidates.length === 0) return null;

  const listText = candidates
    .map(
      (c, i) =>
        `[${i}] title=${JSON.stringify(c.title)}; channel=${JSON.stringify(c.channel_title)}; description=${JSON.stringify(
          c.description.slice(0, 400)
        )}; url=${c.url}`
    )
    .join("\n");

  const prompt = `You rank YouTube videos for gym members learning exercise form for: "${exerciseName}".

RULES (strict):
1. SAFETY FIRST: Prefer clear form tutorials. REJECT spectacle, ego lifts, world records, insane weight PRs, "vs" challenges, compilations, or clickbait where the hook is heavy lifting not teaching.
2. Clickbait example to REJECT: titles centered on how much weight someone lifted rather than how to perform the movement.
3. Tier A: channel or title shows credible coaching signals (DPT, physical therapist, CSCS, exercise physiologist, ACSM, NSCA, clinic, university physio) AND the video is instructional.
4. Tier B: strong instructional value but weaker credential signals — mark reject=true for member-facing strict mode (we only surface Tier A non-rejected).
5. Only use candidate indices from the list. Do not invent URLs.

CANDIDATES:
${listText}

Return JSON picks: up to ${MAX_VIDEOS} items, best first. reject=true means do not show.`;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: RANK_JSON_SCHEMA,
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) return null;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as {
      picks?: Array<{ candidate_index: number; tier: "A" | "B"; reject: boolean }>;
    };
    const out: ExerciseDemoVideo[] = [];
    for (const pick of parsed.picks ?? []) {
      if (pick.reject || pick.tier !== "A") continue;
      const c = candidates[pick.candidate_index];
      if (!c) continue;
      out.push({
        video_id: c.video_id,
        url: c.url,
        title: c.title,
        channel_title: c.channel_title,
        tier: "A",
      });
      if (out.length >= MAX_VIDEOS) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

type SerperOrganic = { title?: string; link?: string; snippet?: string };

async function serperSearch(query: string): Promise<SerperOrganic[]> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];
  try {
    const res = await fetch(`${SERPER_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({ q: query, num: 12 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { organic?: SerperOrganic[] };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

async function youtubeSearch(query: string): Promise<Candidate[]> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query,
      maxResults: "12",
      safeSearch: "strict",
      relevanceLanguage: "en",
      key,
    });
    const res = await fetch(`${YOUTUBE_API}/search?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; description?: string } }>;
    };
    const out: Candidate[] = [];
    for (const item of data.items ?? []) {
      const id = item.id?.videoId;
      if (!id) continue;
      out.push({
        video_id: id,
        url: watchUrl(id),
        title: item.snippet?.title?.trim() || "YouTube video",
        channel_title: item.snippet?.channelTitle?.trim() || "",
        description: item.snippet?.description?.trim() || "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function discoverCandidates(exerciseName: string): Promise<Candidate[]> {
  const q = `"${exerciseName}" exercise form technique how to site:youtube.com`;
  const organic = await serperSearch(q);
  const byId = new Map<string, Candidate>();

  for (const o of organic) {
    const link = o.link?.trim();
    if (!link) continue;
    const id = parseYouTubeVideoId(link);
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        video_id: id,
        url: watchUrl(id),
        title: o.title?.trim() || "YouTube video",
        channel_title: "",
        description: o.snippet?.trim() || "",
      });
    }
  }

  if (byId.size < 4) {
    const ytQ = `${exerciseName} proper form tutorial`;
    for (const c of await youtubeSearch(ytQ)) {
      if (!byId.has(c.video_id)) byId.set(c.video_id, c);
    }
  }

  return Array.from(byId.values()).slice(0, 12);
}

async function enrichAndFilterCandidates(candidates: Candidate[]): Promise<Candidate[]> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key || candidates.length === 0) return candidates;

  const ids = candidates.map((c) => c.video_id).filter(Boolean);
  const enriched: Candidate[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      part: "snippet,status",
      id: chunk.join(","),
      key,
    });
    try {
      const res = await fetch(`${YOUTUBE_API}/videos?${params}`);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          status?: { uploadStatus?: string; privacyStatus?: string };
          snippet?: { title?: string; channelTitle?: string; description?: string };
        }>;
      };
      const prev = new Map(candidates.map((c) => [c.video_id, c]));
      for (const item of data.items ?? []) {
        if (item.status?.privacyStatus !== "public" || item.status?.uploadStatus !== "processed") continue;
        const base = prev.get(item.id);
        enriched.push({
          video_id: item.id,
          url: watchUrl(item.id),
          title: item.snippet?.title?.trim() || base?.title || "YouTube video",
          channel_title: item.snippet?.channelTitle?.trim() || base?.channel_title || "",
          description: item.snippet?.description?.trim() || base?.description || "",
        });
      }
    } catch {
      /* keep going */
    }
  }

  return enriched.length > 0 ? enriched : candidates;
}

export async function validateVideoIds(videoIds: string[]): Promise<Set<string>> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  const alive = new Set<string>();
  if (!key || videoIds.length === 0) return new Set(videoIds);

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({ part: "status", id: chunk.join(","), key });
    try {
      const res = await fetch(`${YOUTUBE_API}/videos?${params}`);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        items?: Array<{ id: string; status?: { privacyStatus?: string; uploadStatus?: string } }>;
      };
      for (const item of data.items ?? []) {
        if (item.status?.privacyStatus === "public" && item.status?.uploadStatus === "processed") {
          alive.add(item.id);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return alive;
}

function readVideosJson(json: string): ExerciseDemoVideo[] {
  try {
    const parsed = JSON.parse(json) as ExerciseDemoVideo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getCachedDemoVideos(
  db: Db,
  cacheKey: string
): { videos: ExerciseDemoVideo[]; fetched_at: string; validated_at: string | null } | null {
  ensureExerciseDemoVideoCacheTable(db);
  const row = db
    .prepare(
      `SELECT videos_json, fetched_at, validated_at, refresh_lock_until FROM exercise_demo_video_cache WHERE cache_key = ?`
    )
    .get(cacheKey) as Pick<CacheRow, "videos_json" | "fetched_at" | "validated_at" | "refresh_lock_until"> | undefined;
  if (!row) return null;
  return {
    videos: readVideosJson(row.videos_json),
    fetched_at: row.fetched_at,
    validated_at: row.validated_at,
  };
}

export type DemoVideosCacheStatus = {
  videos: ExerciseDemoVideo[];
  status: "ready" | "pending" | "unavailable";
  cached: boolean;
  refreshing: boolean;
};

export function evaluateCacheForResponse(
  cached: { videos: ExerciseDemoVideo[]; fetched_at: string; validated_at: string | null } | null
): {
  needsFullRefresh: boolean;
  needsValidation: boolean;
  needsStaleRediscover: boolean;
  showVideos: ExerciseDemoVideo[];
} {
  if (!cached) {
    return { needsFullRefresh: true, needsValidation: false, needsStaleRediscover: false, showVideos: [] };
  }
  const ageDays = daysSince(cached.fetched_at);
  const stale = ageDays > CACHE_TTL_DAYS;
  const needsValidation = daysSince(cached.validated_at) > VALIDATE_INTERVAL_DAYS;
  const needsFullRefresh =
    cached.videos.length === 0 ? ageDays > 14 : stale;
  const needsStaleRediscover = cached.videos.length > 0 && stale;
  return {
    needsFullRefresh,
    needsValidation,
    needsStaleRediscover,
    showVideos: cached.videos,
  };
}

export function isRefreshLocked(db: Db, cacheKey: string): boolean {
  const row = db
    .prepare("SELECT refresh_lock_until FROM exercise_demo_video_cache WHERE cache_key = ?")
    .get(cacheKey) as { refresh_lock_until: string | null } | undefined;
  if (!row?.refresh_lock_until) return false;
  return parseIsoMs(row.refresh_lock_until) > Date.now();
}

function acquireRefreshLock(db: Db, cacheKey: string): boolean {
  if (isRefreshLocked(db, cacheKey)) return false;
  ensureExerciseDemoVideoCacheTable(db);
  const until = new Date(Date.now() + REFRESH_LOCK_MINUTES * 60_000).toISOString();
  db.prepare(
    `INSERT INTO exercise_demo_video_cache (cache_key, exercise_name, videos_json, fetched_at, refresh_lock_until)
     VALUES (?, '', '[]', datetime('now'), ?)
     ON CONFLICT(cache_key) DO UPDATE SET refresh_lock_until = excluded.refresh_lock_until`
  ).run(cacheKey, until);
  return true;
}

function releaseRefreshLock(db: Db, cacheKey: string) {
  db.prepare("UPDATE exercise_demo_video_cache SET refresh_lock_until = NULL WHERE cache_key = ?").run(cacheKey);
}

function saveCache(
  db: Db,
  cacheKey: string,
  exerciseId: number | null,
  exerciseName: string,
  videos: ExerciseDemoVideo[]
) {
  ensureExerciseDemoVideoCacheTable(db);
  const count = db.prepare("SELECT COUNT(*) as n FROM exercise_demo_video_cache").get() as { n: number };
  if (count.n >= CACHE_MAX_ROWS) {
    db.prepare(
      `DELETE FROM exercise_demo_video_cache WHERE cache_key = (
        SELECT cache_key FROM exercise_demo_video_cache ORDER BY fetched_at ASC LIMIT 1
      )`
    ).run();
  }
  const json = JSON.stringify(videos);
  db.prepare(
    `INSERT INTO exercise_demo_video_cache (cache_key, exercise_id, exercise_name, videos_json, fetched_at, validated_at, refresh_lock_until)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL)
     ON CONFLICT(cache_key) DO UPDATE SET
       exercise_id = excluded.exercise_id,
       exercise_name = excluded.exercise_name,
       videos_json = excluded.videos_json,
       fetched_at = excluded.fetched_at,
       validated_at = excluded.validated_at,
       refresh_lock_until = NULL`
  ).run(cacheKey, exerciseId, exerciseName, json);
}

/** Full Serper/YouTube + Gemini refresh (~2–6s). Call in background — not on critical UI path. */
export async function refreshExerciseDemoVideos(
  db: Db,
  cacheKey: string,
  exerciseId: number | null,
  exerciseName: string
): Promise<ExerciseDemoVideo[]> {
  if (!acquireRefreshLock(db, cacheKey)) {
    return getCachedDemoVideos(db, cacheKey)?.videos ?? [];
  }
  try {
    const raw = await discoverCandidates(exerciseName);
    if (raw.length === 0) {
      saveCache(db, cacheKey, exerciseId, exerciseName, []);
      return [];
    }
    const candidates = await enrichAndFilterCandidates(raw);
    let videos = (await rankWithGemini(exerciseName, candidates)) ?? rankHeuristic(candidates);
    if (videos.length === 0) videos = rankHeuristic(candidates).filter((v) => v.tier === "A");
    saveCache(db, cacheKey, exerciseId, exerciseName, videos);
    return videos;
  } catch (e) {
    console.error("[exercise-demo-videos] refresh failed", e);
    return getCachedDemoVideos(db, cacheKey)?.videos ?? [];
  } finally {
    releaseRefreshLock(db, cacheKey);
  }
}

export async function validateCachedDemoVideos(db: Db, cacheKey: string): Promise<ExerciseDemoVideo[]> {
  const cached = getCachedDemoVideos(db, cacheKey);
  if (!cached || cached.videos.length === 0) return [];

  const alive = await validateVideoIds(cached.videos.map((v) => v.video_id));
  const kept = cached.videos.filter((v) => alive.has(v.video_id));

  if (kept.length !== cached.videos.length) {
    const row = db
      .prepare("SELECT exercise_id, exercise_name FROM exercise_demo_video_cache WHERE cache_key = ?")
      .get(cacheKey) as { exercise_id: number | null; exercise_name: string } | undefined;
    saveCache(db, cacheKey, row?.exercise_id ?? null, row?.exercise_name ?? "", kept);
    if (kept.length === 0) {
      return refreshExerciseDemoVideos(db, cacheKey, row?.exercise_id ?? null, row?.exercise_name ?? "");
    }
  } else {
    db.prepare("UPDATE exercise_demo_video_cache SET validated_at = datetime('now') WHERE cache_key = ?").run(cacheKey);
  }
  return kept;
}
