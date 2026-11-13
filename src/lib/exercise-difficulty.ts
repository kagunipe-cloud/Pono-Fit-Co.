/**
 * Exercise difficulty from web grounding (Serper) + Gemini. Cached per exercise_id.
 */

import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

const SERPER_BASE = "https://google.serper.dev";
const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
const GEMINI_MODEL =
  process.env.GEMINI_EXERCISE_MODEL?.trim() ||
  process.env.GEMINI_MACRO_MODEL?.trim() ||
  "gemini-2.5-flash";

export const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExerciseDifficulty = (typeof DIFFICULTY_LEVELS)[number];

const CACHE_TTL_DAYS = 120;

export function ensureExerciseDifficultyCacheTable(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exercise_difficulty_cache (
      exercise_id INTEGER PRIMARY KEY,
      difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
      source_note TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function difficultySortKey(level: string | null | undefined): number {
  if (level === "beginner") return 0;
  if (level === "intermediate") return 1;
  if (level === "advanced") return 2;
  return 9;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso?.trim()) return Infinity;
  const ms = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return Infinity;
  return (Date.now() - ms) / 86_400_000;
}

export function getCachedDifficulty(
  db: Db,
  exerciseId: number
): { difficulty: ExerciseDifficulty; fetched_at: string; source_note: string | null } | null {
  ensureExerciseDifficultyCacheTable(db);
  const row = db
    .prepare("SELECT difficulty, fetched_at, source_note FROM exercise_difficulty_cache WHERE exercise_id = ?")
    .get(exerciseId) as { difficulty: string; fetched_at: string; source_note: string | null } | undefined;
  if (!row || !DIFFICULTY_LEVELS.includes(row.difficulty as ExerciseDifficulty)) return null;
  return {
    difficulty: row.difficulty as ExerciseDifficulty,
    fetched_at: row.fetched_at,
    source_note: row.source_note,
  };
}

export function needsDifficultyRefresh(db: Db, exerciseId: number): boolean {
  const cached = getCachedDifficulty(db, exerciseId);
  if (!cached) return true;
  return daysSince(cached.fetched_at) > CACHE_TTL_DAYS;
}

function saveCachedDifficulty(
  db: Db,
  exerciseId: number,
  difficulty: ExerciseDifficulty,
  sourceNote: string | null
) {
  ensureExerciseDifficultyCacheTable(db);
  db.prepare(
    `INSERT INTO exercise_difficulty_cache (exercise_id, difficulty, source_note, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(exercise_id) DO UPDATE SET
       difficulty = excluded.difficulty,
       source_note = excluded.source_note,
       fetched_at = excluded.fetched_at`
  ).run(exerciseId, difficulty, sourceNote);
}

type SerperOrganic = { title?: string; link?: string; snippet?: string };

async function serperSearch(query: string): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return "";
  try {
    const res = await fetch(`${SERPER_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { organic?: SerperOrganic[]; answerBox?: { answer?: string; snippet?: string } };
    const parts: string[] = [];
    if (data.answerBox?.answer || data.answerBox?.snippet) {
      parts.push(String(data.answerBox.answer ?? data.answerBox.snippet));
    }
    for (const o of data.organic ?? []) {
      if (o.snippet) parts.push(`[${o.title ?? "Result"}]: ${o.snippet}`);
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

const DIFFICULTY_SCHEMA = {
  type: "object",
  properties: {
    difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    rationale: { type: "string", description: "One short sentence citing web consensus" },
  },
  required: ["difficulty", "rationale"],
} as const;

function normalizeGeminiDifficulty(raw: string): ExerciseDifficulty | null {
  const s = raw.trim().toLowerCase();
  if (s === "expert") return "advanced";
  if (DIFFICULTY_LEVELS.includes(s as ExerciseDifficulty)) return s as ExerciseDifficulty;
  return null;
}

/** Look up typical difficulty for a standard gym exercise name (not Fox-specific). */
export async function lookupExerciseDifficultyFromWeb(
  db: Db,
  exerciseId: number,
  exerciseName: string,
  exerciseType: string,
  options?: { force?: boolean }
): Promise<ExerciseDifficulty | null> {
  if (!options?.force && !needsDifficultyRefresh(db, exerciseId)) {
    return getCachedDifficulty(db, exerciseId)?.difficulty ?? null;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) return null;

  const query = `${exerciseName} exercise difficulty level beginner intermediate advanced`;
  const context = await serperSearch(query);

  const prompt = context.trim()
    ? `Use ONLY the WEB SNIPPETS below to classify how difficult "${exerciseName}" (${exerciseType}) is for a typical healthy adult at a commercial gym.

WEB SNIPPETS:
---
${context}
---

Rules:
- beginner: fundamental, low skill/coordination, common in intro programs
- intermediate: needs some experience or technique (most compound lifts)
- advanced: high skill, instability, heavy technique demand, or not for novices
- If snippets disagree, pick the most common coaching consensus.
- Map "expert" to advanced.

Return JSON only.`
    : `Classify gym exercise difficulty for "${exerciseName}" (${exerciseType}) using common strength & conditioning consensus (ACSM/NSCA-style), not one person's opinion.

- beginner / intermediate / advanced only.
Return JSON only.`;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 256,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: DIFFICULTY_SCHEMA,
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) return getCachedDifficulty(db, exerciseId)?.difficulty ?? null;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as { difficulty?: string; rationale?: string };
    const level = normalizeGeminiDifficulty(String(parsed.difficulty ?? ""));
    if (!level) return null;
    const note = parsed.rationale?.trim().slice(0, 500) || null;
    saveCachedDifficulty(db, exerciseId, level, note);
    return level;
  } catch (e) {
    console.error("[exercise-difficulty] lookup failed", exerciseName, e);
    return getCachedDifficulty(db, exerciseId)?.difficulty ?? null;
  }
}

export function loadGymPopularityMap(db: Db): Map<number, { log_count: number; member_count: number }> {
  const rows = db
    .prepare(
      `SELECT we.exercise_id AS exercise_id,
              COUNT(*) AS log_count,
              COUNT(DISTINCT w.member_id) AS member_count
       FROM workout_exercises we
       INNER JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id IS NOT NULL
       GROUP BY we.exercise_id`
    )
    .all() as { exercise_id: number; log_count: number; member_count: number }[];
  return new Map(rows.map((r) => [r.exercise_id, { log_count: r.log_count, member_count: r.member_count }]));
}
