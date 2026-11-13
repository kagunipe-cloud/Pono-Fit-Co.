/**
 * Primary / secondary / antagonist muscles via Serper + Gemini, normalized to app vocabulary.
 */

import type { getDb } from "./db";
import { getMuscleGroup } from "./muscle-groups";
import {
  getCanonicalMuscleVocabulary,
  joinMuscleCsv,
  normalizeMuscleList,
} from "./exercise-muscle-vocabulary";
import { parseMovementClass, type MovementClass } from "./exercise-movement-class";

type Db = ReturnType<typeof getDb>;

const SERPER_BASE = "https://google.serper.dev";
const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
const GEMINI_MODEL =
  process.env.GEMINI_EXERCISE_MODEL?.trim() ||
  process.env.GEMINI_MACRO_MODEL?.trim() ||
  "gemini-2.5-flash";

const ENRICH_TTL_DAYS = 120;

export type MuscleEnrichConfidence = "high" | "medium" | "low";

export type MuscleEnrichResult = {
  primary_muscles: string;
  secondary_muscles: string;
  antagonist_muscles: string;
  muscle_group: string;
  movement_class: MovementClass | null;
  confidence: MuscleEnrichConfidence;
  rationale: string;
};

const VOCAB = getCanonicalMuscleVocabulary();

const MUSCLE_ENRICH_SCHEMA = {
  type: "object",
  properties: {
    primary_muscles: {
      type: "array",
      items: { type: "string" },
      description: "Primary movers; each string MUST be exactly one allowed muscle term",
    },
    secondary_muscles: {
      type: "array",
      items: { type: "string" },
    },
    antagonist_muscles: {
      type: "array",
      items: { type: "string" },
      description: "1-3 antagonists for the movement pattern; empty if uncertain",
    },
    movement_class: {
      type: "string",
      enum: ["compound", "isolation", "not_applicable"],
      description:
        "compound = multi-joint lift; isolation = single-joint emphasis; not_applicable for stretch/cardio or ambiguous",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
  },
  required: [
    "primary_muscles",
    "secondary_muscles",
    "antagonist_muscles",
    "movement_class",
    "confidence",
    "rationale",
  ],
} as const;

function daysSince(iso: string | null | undefined): number {
  if (!iso?.trim()) return Infinity;
  const ms = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return Infinity;
  return (Date.now() - ms) / 86_400_000;
}

export function ensureExerciseMuscleEnrichColumns(db: Db) {
  const cols = db.prepare("PRAGMA table_info(exercises)").all() as { name: string }[];
  for (const col of ["antagonist_muscles", "movement_class", "muscles_enriched_at", "muscles_enrich_confidence"]) {
    if (cols.every((c) => c.name !== col)) {
      try {
        db.prepare(`ALTER TABLE exercises ADD COLUMN ${col} TEXT`).run();
      } catch {
        /* ignore */
      }
    }
  }
}

function needsMuscleRefresh(db: Db, exerciseId: number): boolean {
  ensureExerciseMuscleEnrichColumns(db);
  const row = db
    .prepare("SELECT muscles_enriched_at FROM exercises WHERE id = ?")
    .get(exerciseId) as { muscles_enriched_at: string | null } | undefined;
  return daysSince(row?.muscles_enriched_at) > ENRICH_TTL_DAYS;
}

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
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; snippet?: string }>;
      answerBox?: { answer?: string; snippet?: string };
    };
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

function parseConfidence(raw: string): MuscleEnrichConfidence {
  const s = raw.trim().toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "low";
}

function buildResultFromParsed(
  parsed: {
    primary_muscles?: string[];
    secondary_muscles?: string[];
    antagonist_muscles?: string[];
    movement_class?: string;
    confidence?: string;
    rationale?: string;
  },
  exerciseType: string
): MuscleEnrichResult | null {
  const primary = normalizeMuscleList(parsed.primary_muscles ?? []);
  if (primary.length === 0 && exerciseType === "lift") return null;
  const secondary = normalizeMuscleList(parsed.secondary_muscles ?? []);
  const antagonist = normalizeMuscleList(parsed.antagonist_muscles ?? []);
  const confidence = parseConfidence(String(parsed.confidence ?? "low"));
  const rationale = String(parsed.rationale ?? "").trim().slice(0, 500);
  const primaryCsv = joinMuscleCsv(primary);
  const movement_class =
    exerciseType === "lift"
      ? parseMovementClass(
          parsed.movement_class === "not_applicable" ? null : parsed.movement_class,
          exerciseType
        )
      : null;
  return {
    primary_muscles: primaryCsv,
    secondary_muscles: joinMuscleCsv(secondary),
    antagonist_muscles: joinMuscleCsv(antagonist),
    muscle_group: getMuscleGroup(primaryCsv || null, undefined),
    movement_class,
    confidence,
    rationale,
  };
}

export async function enrichExerciseMusclesFromWeb(
  db: Db,
  exerciseId: number,
  exerciseName: string,
  exerciseType: string,
  options?: { force?: boolean; applyLow?: boolean }
): Promise<(MuscleEnrichResult & { applied: boolean }) | null> {
  ensureExerciseMuscleEnrichColumns(db);

  if (!options?.force && !needsMuscleRefresh(db, exerciseId)) {
    const row = db
      .prepare(
        `SELECT primary_muscles, secondary_muscles, antagonist_muscles, muscle_group, movement_class,
                muscles_enrich_confidence, muscles_enriched_at
         FROM exercises WHERE id = ?`
      )
      .get(exerciseId) as {
      primary_muscles: string | null;
      secondary_muscles: string | null;
      antagonist_muscles: string | null;
      muscle_group: string | null;
      movement_class: string | null;
      muscles_enrich_confidence: string | null;
      muscles_enriched_at: string | null;
    } | undefined;
    if (row?.muscles_enriched_at) {
      return {
        primary_muscles: row.primary_muscles ?? "",
        secondary_muscles: row.secondary_muscles ?? "",
        antagonist_muscles: row.antagonist_muscles ?? "",
        muscle_group: row.muscle_group ?? "",
        movement_class: parseMovementClass(row.movement_class, exerciseType),
        confidence: parseConfidence(row.muscles_enrich_confidence ?? "low"),
        rationale: "",
        applied: false,
      };
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) return null;

  const query = `${exerciseName} exercise compound or isolation primary secondary muscles`;
  const context = await serperSearch(query);
  const vocabList = VOCAB.join(", ");

  const prompt = `Classify muscles for gym exercise: "${exerciseName}" (type: ${exerciseType}).

ALLOWED MUSCLE TERMS (use ONLY these exact strings, lowercase):
${vocabList}

${context.trim() ? `WEB SNIPPETS:\n---\n${context}\n---\n` : ""}

Rules:
- primary_muscles: main force producers (1-4 terms from allowed list).
- secondary_muscles: meaningful assistants, NOT duplicates of primary (0-5 terms).
- antagonist_muscles: opposite movers for this pattern (0-3 terms); empty if unclear.
- movement_class: for type lift only — compound (multi-joint, eg squat, bench, row) vs isolation (single-joint emphasis, eg curl, extension, fly). Use not_applicable for stretch/cardio or if unclear.
- Map synonyms to allowed terms (e.g. lats → latissimus dorsi, quads → quadriceps).
- confidence high = strong consensus; medium = reasonable; low = guess or sparse data.
- stretch/cardio: movement_class not_applicable; muscles optional.

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
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: MUSCLE_ENRICH_SCHEMA,
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) return null;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as Parameters<typeof buildResultFromParsed>[0];
    const built = buildResultFromParsed(parsed, exerciseType);
    if (!built) return null;

    const shouldApply =
      built.confidence === "high" ||
      built.confidence === "medium" ||
      (options?.applyLow === true && built.confidence === "low");

    if (shouldApply) {
      db.prepare(
        `UPDATE exercises SET
          primary_muscles = ?,
          secondary_muscles = ?,
          antagonist_muscles = ?,
          muscle_group = ?,
          movement_class = ?,
          muscles_enriched_at = datetime('now'),
          muscles_enrich_confidence = ?
         WHERE id = ?`
      ).run(
        built.primary_muscles || null,
        built.secondary_muscles || null,
        built.antagonist_muscles || null,
        built.muscle_group,
        built.movement_class,
        built.confidence,
        exerciseId
      );
    }

    return { ...built, applied: shouldApply };
  } catch (e) {
    console.error("[exercise-muscle-enrich] failed", exerciseName, e);
    return null;
  }
}
