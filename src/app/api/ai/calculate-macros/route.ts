import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCachedMacros, setCachedMacros } from "@/lib/ai-macros-cache";

export const dynamic = "force-dynamic";

// Uses v1beta + Flash. Override GEMINI_API_VERSION / GEMINI_MACRO_MODEL in env if needed.
const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
// gemini-2.0-flash is deprecated; new keys often fail. https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash
const DEFAULT_MODEL = process.env.GEMINI_MACRO_MODEL?.trim() || "gemini-2.5-flash";

// Serper: Google search API for grounding. 2,500 free queries. https://serper.dev
const SERPER_BASE = "https://google.serper.dev";

/**
 * Forces all four fields as JSON numbers so the model can't omit macros.
 * @see https://ai.google.dev/gemini-api/docs/structured-output
 */
const MACRO_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    calories: {
      type: "number",
      description:
        "Total calories (kcal) for the Request portion; must align with one consistent serving from WEB SEARCH RESULTS.",
    },
    protein_g: {
      type: "number",
      description: "Total protein in grams for that same serving. From results text when given (e.g. 0.5g protein).",
    },
    fat_g: {
      type: "number",
      description: "Total fat in grams for that same serving.",
    },
    carbs_g: {
      type: "number",
      description: "Total carbohydrates in grams (total carbs) for that same serving.",
    },
  },
  required: ["calories", "protein_g", "fat_g", "carbs_g"],
} as const;

/** Set GEMINI_MACRO_DEBUG_SERPER=1 to log Serper query + context and attach `_debug` to the JSON response (local troubleshooting). */
const DEBUG_SERPER = process.env.GEMINI_MACRO_DEBUG_SERPER?.trim() === "1";

// Gemini free tier is strict. https://ai.google.dev/gemini-api/docs/rate-limits

type SerperOrganic = { title?: string; link?: string; snippet?: string; position?: number };
type SerperResponse = {
  organic?: SerperOrganic[];
  knowledgeGraph?: { title?: string; description?: string; attributes?: Record<string, string> };
  answerBox?: { title?: string; answer?: string; snippet?: string };
  peopleAlsoAsk?: Array<{ question?: string; snippet?: string }>;
};
type CalculateBody = { food: string; portionValue: number; portionUnit: string; skipCache?: boolean };

/** Set GEMINI_MACRO_SKIP_CACHE=1 in .env to never read cache (local debug / bad rows). */
function shouldBypassMacroCache(body: CalculateBody): boolean {
  if (process.env.GEMINI_MACRO_SKIP_CACHE?.trim() === "1") return true;
  if (body.skipCache !== true) return false;
  return (
    process.env.NODE_ENV === "development" ||
    process.env.GEMINI_MACRO_ALLOW_SKIP_CACHE?.trim() === "1"
  );
}

function concatGeminiCandidateText(data: {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}): string {
  for (const cand of data.candidates ?? []) {
    const parts = cand?.content?.parts ?? [];
    const merged = parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (merged) return merged;
  }
  return "";
}

function geminiEmptyResponseMessage(data: {
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}): string {
  const block = data.promptFeedback?.blockReason;
  if (block)
    return `Gemini blocked the request (${block}). Try rephrasing the food description or wait and retry.`;
  const finish = data.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP")
    return `No usable text from Gemini (finishReason: ${finish}). Try again or shorten the prompt.`;
  return "No response from Gemini — try again in a moment.";
}

/** Gemini often adds prose or fences even with responseMimeType application/json — avoid JSON.parse throws. */
function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const cleaned = s
    .trim()
    .replace(/,\s*([\]}])/g, "$1");
  try {
    const o = JSON.parse(cleaned) as unknown;
    if (Array.isArray(o) && o.length > 0) {
      const first = o[0];
      if (first !== null && typeof first === "object" && !Array.isArray(first)) {
        return first as Record<string, unknown>;
      }
      return null;
    }
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** First top-level `{ ... }` with string-aware brace matching (handles `}` inside quoted text). */
function extractFirstJsonObject(src: string): string | null {
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let q: '"' | "'" | null = null;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseMacrosJsonFromModelText(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"');

  if (!trimmed) return null;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenceInner = fence ? fence[1].trim() : null;

  const trySlice = (chunk: string): Record<string, unknown> | null => {
    if (!chunk) return null;
    let parsed = tryParseJsonObject(chunk);
    if (parsed) return parsed;
    const inner = extractFirstJsonObject(chunk);
    if (inner && inner !== chunk) {
      parsed = tryParseJsonObject(inner);
      if (parsed) return parsed;
    }
    return null;
  };

  if (fenceInner) {
    const fromFence = trySlice(fenceInner);
    if (fromFence) return fromFence;
  }

  const fromFull = trySlice(trimmed);
  if (fromFull) return fromFull;

  const loose = trimmed.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
  if (loose) return tryParseJsonObject(loose[0]);

  return null;
}

/** Last resort: pull key/value numbers from almost-JSON or messy model text. */
function looseExtractMacroFields(text: string): Record<string, unknown> | null {
  const t = text.replace(/[\u201C\u201D]/g, '"').slice(0, 12_000);
  const grab = (patterns: RegExp[]): number | null => {
    for (const re of patterns) {
      const m = t.match(re);
      if (m?.[1]) {
        const n = parseFloat(String(m[1]).replace(/,/g, ""));
        if (Number.isFinite(n) && n >= 0 && n < 500_000) return n;
      }
    }
    return null;
  };

  const calories = grab([
    /["']calories["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /\bcalories\s*:\s*([\d,]+(?:\.\d+)?)/i,
  ]);
  const protein_g = grab([
    /["']protein_g["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /["']protein["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
  ]);
  const fat_g = grab([
    /["']fat_g["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /["']fat["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
  ]);
  const carbs_g = grab([
    /["']carbs_g["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /["']carbs["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /["']carbohydrates["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
    /["']total[_\s]?carbohydrate[s]?["']\s*:\s*([\d,]+(?:\.\d+)?)/i,
  ]);

  if (calories == null && protein_g == null && fat_g == null && carbs_g == null) return null;
  const o: Record<string, unknown> = {};
  if (calories != null) o.calories = calories;
  if (protein_g != null) o.protein_g = protein_g;
  if (fat_g != null) o.fat_g = fat_g;
  if (carbs_g != null) o.carbs_g = carbs_g;
  return o;
}


/**
 * POST — get nutrition (calories, protein_g, fat_g, carbs_g) for a food + portion via Gemini.
 * Body: { food: string, portionValue: number, portionUnit: string, skipCache?: boolean }.
 * Cache: set GEMINI_MACRO_SKIP_CACHE=1 to skip cache reads. In development only, pass skipCache: true
 * for a one-off bypass (or GEMINI_MACRO_ALLOW_SKIP_CACHE=1 in any env). Requires GEMINI_API_KEY.
 * Optional SERPER_API_KEY: when set, searches the web first and grounds Gemini with real results
 *   (better accuracy for branded products). Get free key at https://serper.dev
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as CalculateBody;
    const food = String(body.food ?? "").trim();
    const portionValue = typeof body.portionValue === "number" ? body.portionValue : parseFloat(String(body.portionValue ?? 1)) || 1;
    const portionUnit = String(body.portionUnit ?? "").trim();

    if (!food) {
      return NextResponse.json({ error: "food is required" }, { status: 400 });
    }

    // Strip trailing meta-words that users often type (e.g. "musashi high protein bar macros")
    // Avoid stripping words that may be part of product names (e.g. "protein" in "High Protein Bar")
    const foodCleaned = food
      .replace(/\s+(macros?|nutrition\s*facts?|calories?)\s*$/i, "")
      .trim() || food;

    let db: ReturnType<typeof getDb> | null = getDb();
    try {
      const bypassCache = shouldBypassMacroCache(body);
      if (!bypassCache) {
        const cached = getCachedMacros(db, foodCleaned, portionValue, portionUnit);
        if (cached) return NextResponse.json(cached);
      }

      // When unit is null/blank: search exactly what's in the food bar (e.g. "7 nilla wafers"). When unit is set: "macros for 4 servings of oreos".
    const query = portionUnit
      ? (() => {
          const unitWord = portionValue === 1 ? portionUnit : portionUnit === "oz" ? "oz" : portionUnit + "s";
          return `macros for ${portionValue} ${unitWord} of ${foodCleaned}`;
        })()
      : `macros for ${foodCleaned}`;

    // Step 1: Search the web for nutrition data (grounding). Uses Serper if SERPER_API_KEY is set.
    const searchQuery = `${foodCleaned} nutrition facts calories protein carbs`;
    const serperData = await searchWeb(searchQuery);
    const searchContext = serperData ? buildSearchContext(serperData) : "";

    const hasGrounding = searchContext.length > 0;
    if (DEBUG_SERPER) {
      console.log("[calculate-macros] Serper q:", searchQuery);
      console.log(
        "[calculate-macros] Serper → Gemini context:\n",
        hasGrounding ? searchContext : "(empty — no SERPER_API_KEY, Serper error, or no snippets)"
      );
    }

    const prompt = hasGrounding
      ? `You are a nutrition calculator. Use the WEB SEARCH RESULTS below to find accurate nutrition. Return ONLY a valid JSON object, no other text.

WEB SEARCH RESULTS:
---
${searchContext}
---

RULES:
1. Extract calories, protein_g, fat_g, carbs_g from the WEB SEARCH RESULTS only. Prefer the answer box when it lists full macros; otherwise the clearest snippet that matches the Request portion.
2. The numbers must be the TOTAL for the entire amount requested. If the user asks for "7 nilla wafers", return the sum for all 7. If no portion/count is given, return per 1 unit/serving (e.g. per 1 bar, one fruit as described in the results).
3. If the results state protein, fat, or carbohydrates/carbs in grams (e.g. "1.3g of protein", "16.5 grams of carbohydrates"), you MUST set protein_g, fat_g, and carbs_g to those numbers for the same serving size as the calories you chose. Do not output 0 for a macro when that macro appears in the results for that serving—zeros are only for a macro truly absent from the text.
4. Use the numeric values given in the results (no inventing conflicting numbers). Map total carbohydrates / "carbohydrates" / carbs to carbs_g unless only net carbs is explicit.
5. When values are given as RANGES (e.g. 60-70 calories, 16g-17g carbs), use the LOW end of the range. Most labels report the low end.

Request: "${query}"

Respond with exactly this format (numbers only):
{"calories": <number>, "protein_g": <number>, "fat_g": <number>, "carbs_g": <number>}`
      : `You are a nutrition calculator. Return ONLY a valid JSON object, no other text.

Rules:
1. The numbers must be the TOTAL for the entire amount requested. If the user asks for "7 nilla wafers", return the sum for all 7 wafers (e.g. ~122 cal), NOT for 1 wafer and NOT per 100g. Always multiply per-unit nutrition by the number of units when a count is given.
2. For BRANDED PRODUCTS (e.g. "Musashi High Protein Bar", "Quest Bar", "Clif Bar"): Use the OFFICIAL nutrition facts from the product label. Do not estimate or substitute generic values. If you know the real nutrition from the brand's packaging or website, use those exact numbers. Branded products have specific formulations that differ from generic versions.
3. When no portion/count is given, return nutrition per 1 unit/serving (e.g. per 1 bar, per 1 cup) as stated on the label.
4. When values are given as RANGES (e.g. 60-70 calories, 16g-17g carbs), use the LOW end of the range. Most labels report the low end.

Request: "${query}"

Respond with exactly this format (numbers only, USDA-style):
{"calories": <number>, "protein_g": <number>, "fat_g": <number>, "carbs_g": <number>}`;

    const url = `${GEMINI_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          // Thinking + visible output share this cap on 2.5 Flash; low limits truncate structured JSON mid-stream.
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: MACRO_RESPONSE_JSON_SCHEMA,
        },
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };

    const finishReason = data.candidates?.[0]?.finishReason;

    if (!res.ok) {
      const msg = data.error?.message ?? "Gemini request failed";
      console.error(
        "[calculate-macros] Gemini HTTP",
        res.status,
        JSON.stringify(data.error ?? data).slice(0, 2000)
      );
      const isModelAccess =
        res.status === 404 ||
        /\bno longer available\b|\bdeprecated\b|\bMODEL_NOT_FOUND\b|\binvalid model\b|\bnot found\b.*model/i.test(
          msg
        );
      if (isModelAccess) {
        return NextResponse.json(
          {
            error: `${msg} Set GEMINI_MACRO_MODEL in env to a current model (e.g. gemini-2.5-flash).`,
          },
          { status: 502 }
        );
      }
      const isQuota =
        res.status === 429 ||
        /\bquota\b|\brate limit\b|\bexceeded your\b|\bRPD\b|\bRPM\b/i.test(msg);
      const isOverload =
        /\bhigh demand\b|\bresource exhausted\b|\bspikes?\b.*demand|overload|\bcapacity\b|try again later|\btemporarily unavailable\b/i.test(
          msg
        ) || res.status === 503;
      if (isOverload) {
        return NextResponse.json(
          {
            error:
              "Google’s model is busy right now (high demand). Wait 30–60 seconds and tap Calculate again.",
          },
          { status: 503, headers: { "Retry-After": "35" } }
        );
      }
      const userMsg = isQuota
        ? "API rate limit reached. Please wait a minute and try again."
        : msg;
      return NextResponse.json(
        { error: userMsg },
        { status: isQuota ? 429 : (res.status >= 400 ? res.status : 500) }
      );
    }

    const text = concatGeminiCandidateText(data);
    if (!text) {
      console.error("[calculate-macros] empty Gemini body:", JSON.stringify(data).slice(0, 2000));
      return NextResponse.json({ error: geminiEmptyResponseMessage(data) }, { status: 502 });
    }

    if (finishReason && finishReason !== "STOP") {
      console.error("[calculate-macros] Gemini finishReason:", finishReason, "text slice:", text.slice(0, 500));
    }

    let parsed = parseMacrosJsonFromModelText(text);
    const parsedFromStructuredJson = parsed != null;
    if (!parsed) parsed = looseExtractMacroFields(text);
    if (!parsed) {
      console.error("[calculate-macros] JSON parse failed, model text:", text.slice(0, 2000));
      return NextResponse.json(
        {
          error:
            "Could not read nutrition JSON from Gemini. Try again or rephrase the food description.",
        },
        { status: 502 }
      );
    }

    if (!parsedFromStructuredJson) {
      const c = num(parsed.calories);
      const p = num(parsed.protein_g ?? parsed.protein);
      const f = num(parsed.fat_g ?? parsed.fat);
      const cb = num(parsed.carbs_g ?? parsed.carbs ?? parsed.carbohydrates);
      if (c != null && p == null && f == null && cb == null) {
        console.error(
          "[calculate-macros] incomplete model JSON (loose parse, calories only). finishReason:",
          finishReason,
          "text:",
          text.slice(0, 500)
        );
        return NextResponse.json(
          {
            error:
              "Nutrition response from the model was incomplete. Tap Calculate again — if this keeps happening, report it.",
          },
          { status: 502 }
        );
      }
    }

    const nest =
      parsed.nutrition != null && typeof parsed.nutrition === "object" && !Array.isArray(parsed.nutrition)
        ? (parsed.nutrition as Record<string, unknown>)
        : null;
    const calories = num(parsed.calories);
    const protein_g = num(parsed.protein_g ?? parsed.protein ?? nest?.protein_g ?? nest?.protein);
    const fat_g = num(parsed.fat_g ?? parsed.fat ?? nest?.fat_g ?? nest?.fat);
    const carbs_g = num(
      parsed.carbs_g ?? parsed.carbs ?? parsed.carbohydrates ?? nest?.carbs_g ?? nest?.carbs ?? nest?.carbohydrates
    );

    if (calories == null && protein_g == null && fat_g == null && carbs_g == null) {
      return NextResponse.json({ error: "Could not parse nutrition from response" }, { status: 502 });
    }

    const result = {
      calories: calories ?? 0,
      protein_g: protein_g ?? 0,
      fat_g: fat_g ?? 0,
      carbs_g: carbs_g ?? 0,
    };
    setCachedMacros(db, foodCleaned, portionValue, portionUnit, result);
    if (DEBUG_SERPER) {
      return NextResponse.json({
        ...result,
        _debug: {
          serperQuery: searchQuery,
          grounded: hasGrounding,
          contextCharLength: searchContext.length,
          context: searchContext,
          geminiRawText: text.slice(0, 8000),
          geminiFinishReason: finishReason ?? null,
          parsedBeforeNums: parsed,
        },
      });
    }
    return NextResponse.json(result);
    } finally {
      db?.close();
    }
  } catch (err) {
    console.error("[calculate-macros]", err);
    const hint =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown error";
    const error =
      process.env.NODE_ENV === "development"
        ? `Failed to calculate macros (${hint})`
        : "Failed to calculate macros";
    return NextResponse.json({ error }, { status: 500 });
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

/** Fetch Google search results via Serper. Returns null if not configured or fails. */
async function searchWeb(query: string): Promise<SerperResponse | null> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${SERPER_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as SerperResponse | null;
    return data;
  } catch {
    return null;
  }
}

/** Build context string from Serper results for Gemini to use. */
function buildSearchContext(serper: SerperResponse): string {
  const parts: string[] = [];
  if (serper.answerBox?.answer || serper.answerBox?.snippet) {
    parts.push(`Answer box: ${serper.answerBox.answer ?? serper.answerBox.snippet ?? ""}`);
  }
  if (serper.knowledgeGraph?.description) {
    parts.push(`Knowledge: ${serper.knowledgeGraph.description}`);
  }
  if (serper.knowledgeGraph?.attributes) {
    const attrs = Object.entries(serper.knowledgeGraph.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    if (attrs) parts.push(`Attributes: ${attrs}`);
  }
  for (const o of serper.organic ?? []) {
    const snip = o.snippet?.trim();
    if (snip) parts.push(`[${o.title ?? "Result"}]: ${snip}`);
  }
  for (const pa of serper.peopleAlsoAsk ?? []) {
    if (pa.snippet) parts.push(`Q: ${pa.question ?? ""} A: ${pa.snippet}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "";
}
