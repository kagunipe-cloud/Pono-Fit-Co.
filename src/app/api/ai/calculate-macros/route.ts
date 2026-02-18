import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Uses v1beta + gemini-2.0-flash by default. Override with GEMINI_API_VERSION and GEMINI_MODEL if needed.
const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
const DEFAULT_MODEL = "gemini-2.0-flash";

type CalculateBody = { food: string; portionValue: number; portionUnit: string };

/**
 * POST — get nutrition (calories, protein_g, fat_g, carbs_g) for a food + portion via Gemini.
 * Body: { food: string, portionValue: number, portionUnit: string }.
 * Requires GEMINI_API_KEY in env.
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

    // When unit is null/blank: search exactly what's in the food bar (e.g. "7 nilla wafers"). When unit is set: "macros for 4 servings of oreos".
    const query = portionUnit
      ? (() => {
          const unitWord = portionValue === 1 ? portionUnit : portionUnit === "oz" ? "oz" : portionUnit + "s";
          return `macros for ${portionValue} ${unitWord} of ${food}`;
        })()
      : `macros for ${food}`;

    const prompt = `You are a nutrition calculator. Return ONLY a valid JSON object, no other text.

Rule: The numbers must be the TOTAL for the entire amount requested. If the user asks for "7 nilla wafers", return the sum for all 7 wafers (e.g. ~122 cal), NOT for 1 wafer and NOT per 100g. Always multiply per-unit nutrition by the number of units when a count is given.

Request: "${query}"

Respond with exactly this format (numbers only, USDA-style):
{"calories": <number>, "protein_g": <number>, "fat_g": <number>, "carbs_g": <number>}`;

    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message ?? "Gemini request failed";
      const isQuota = res.status === 429 || /quota|rate limit|retry/i.test(msg);
      const userMsg = isQuota
        ? "API rate limit reached. Please wait a minute and try again."
        : msg;
      return NextResponse.json(
        { error: userMsg },
        { status: isQuota ? 429 : (res.status >= 400 ? res.status : 500) }
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) {
      return NextResponse.json({ error: "No response from Gemini" }, { status: 502 });
    }

    // Strip markdown code block if present
    let raw = text;
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) raw = codeMatch[1].trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const calories = num(parsed.calories);
    const protein_g = num(parsed.protein_g ?? parsed.protein);
    const fat_g = num(parsed.fat_g ?? parsed.fat);
    const carbs_g = num(parsed.carbs_g ?? parsed.carbs ?? parsed.carbohydrates);

    if (calories == null && protein_g == null && fat_g == null && carbs_g == null) {
      return NextResponse.json({ error: "Could not parse nutrition from response" }, { status: 502 });
    }

    return NextResponse.json({
      calories: calories ?? 0,
      protein_g: protein_g ?? 0,
      fat_g: fat_g ?? 0,
      carbs_g: carbs_g ?? 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to calculate macros" }, { status: 500 });
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}
