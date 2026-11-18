import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";
import {
  clampMealTargetsToRemaining,
  macroGramGoalsFromGoals,
  macroRemaining,
  type MacroTotals,
  type MealIdea,
} from "@/lib/macro-meal-machine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GEMINI_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_VERSION}`;
const DEFAULT_MODEL = process.env.GEMINI_MACRO_MODEL?.trim() || "gemini-2.5-flash";

const MEAL_IDEAS_JSON_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          summary: { type: "string", description: "One short sentence: what to make and how it fits." },
          est_calories: { type: "number" },
          est_protein_g: { type: "number" },
          est_fat_g: { type: "number" },
          est_carbs_g: { type: "number" },
          recipe_search_query: {
            type: "string",
            description: "Short web search query for a recipe (no URL — app will link to search).",
          },
        },
        required: [
          "name",
          "summary",
          "est_calories",
          "est_protein_g",
          "est_fat_g",
          "est_carbs_g",
          "recipe_search_query",
        ],
      },
    },
  },
  required: ["ideas"],
} as const;

function concatGeminiCandidateText(data: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

function sumMemberDayTotals(
  db: ReturnType<typeof getDb>,
  memberId: string,
  date: string
): MacroTotals {
  const day = db
    .prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?")
    .get(memberId, date) as { id: number } | undefined;
  if (!day) {
    return { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  }
  const meals = db
    .prepare("SELECT id FROM journal_meals WHERE journal_day_id = ?")
    .all(day.id) as { id: number }[];
  const getFood = db.prepare(
    "SELECT calories, protein_g, fat_g, carbs_g FROM foods WHERE id = ?"
  );
  let calories = 0;
  let protein_g = 0;
  let fat_g = 0;
  let carbs_g = 0;
  for (const meal of meals) {
    const entries = db
      .prepare("SELECT food_id, amount FROM journal_meal_entries WHERE journal_meal_id = ?")
      .all(meal.id) as { food_id: number; amount: number }[];
    for (const e of entries) {
      const food = getFood.get(e.food_id) as
        | { calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null }
        | undefined;
      if (!food) continue;
      const amount = Number(e.amount) || 0;
      calories += (Number(food.calories) || 0) * amount;
      protein_g += (Number(food.protein_g) || 0) * amount;
      fat_g += (Number(food.fat_g) || 0) * amount;
      carbs_g += (Number(food.carbs_g) || 0) * amount;
    }
  }
  return { calories, protein_g, fat_g, carbs_g };
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseMealIdeas(text: string): MealIdea[] | null {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const chunk = fence ? fence[1]!.trim() : trimmed;
  try {
    const parsed = JSON.parse(chunk) as { ideas?: unknown[] };
    if (!Array.isArray(parsed.ideas)) return null;
    const ideas: MealIdea[] = [];
    for (const raw of parsed.ideas.slice(0, 4)) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const summary = String(o.summary ?? "").trim();
      const recipe_search_query = String(o.recipe_search_query ?? o.recipeSearchQuery ?? "").trim();
      const est_calories = num(o.est_calories ?? o.calories);
      const est_protein_g = num(o.est_protein_g ?? o.protein_g);
      const est_fat_g = num(o.est_fat_g ?? o.fat_g);
      const est_carbs_g = num(o.est_carbs_g ?? o.carbs_g);
      if (!name || !recipe_search_query) continue;
      ideas.push({
        name,
        summary: summary || "Quick idea from your ingredients.",
        est_calories: est_calories ?? 0,
        est_protein_g: est_protein_g ?? 0,
        est_fat_g: est_fat_g ?? 0,
        est_carbs_g: est_carbs_g ?? 0,
        recipe_search_query,
      });
    }
    return ideas.length > 0 ? ideas : null;
  } catch {
    return null;
  }
}

/**
 * POST — Macro Meal Machine: 3–4 meal ideas from ingredients + this meal’s macro targets.
 * Body: { date, ingredients, meal_targets: { calories, protein_g, fat_g, carbs_g } }
 */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      date?: string;
      ingredients?: string;
      meal_targets?: Partial<MacroTotals>;
    };

    const date = String(body.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Valid date (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const ingredients = String(body.ingredients ?? "").trim();
    if (ingredients.length < 2) {
      return NextResponse.json({ error: "Tell us what ingredients you can use (a few words minimum)." }, { status: 400 });
    }

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);

    const goalRow = db
      .prepare(
        "SELECT calories_goal, protein_pct, fat_pct, carbs_pct FROM member_macro_goals WHERE member_id = ?"
      )
      .get(memberId) as {
      calories_goal: number | null;
      protein_pct: number | null;
      fat_pct: number | null;
      carbs_pct: number | null;
    } | undefined;

    const daily = macroGramGoalsFromGoals(
      goalRow?.calories_goal ?? null,
      goalRow?.protein_pct ?? null,
      goalRow?.fat_pct ?? null,
      goalRow?.carbs_pct ?? null
    );

    if (!daily) {
      db.close();
      return NextResponse.json(
        { error: "Set daily calorie and macro goals on My Macros first." },
        { status: 400 }
      );
    }

    const consumed = sumMemberDayTotals(db, memberId, date);
    const remaining = macroRemaining(daily, consumed);
    db.close();

    const mt = body.meal_targets ?? {};
    const requested: MacroTotals = {
      calories: Math.max(0, num(mt.calories) ?? 0),
      protein_g: Math.max(0, num(mt.protein_g) ?? 0),
      fat_g: Math.max(0, num(mt.fat_g) ?? 0),
      carbs_g: Math.max(0, num(mt.carbs_g) ?? 0),
    };

    if (requested.calories <= 0) {
      return NextResponse.json({ error: "Meal calorie target must be greater than zero." }, { status: 400 });
    }

    const meal_targets = clampMealTargetsToRemaining(requested, remaining);

    const prompt = `You help gym members cook ONE meal at home using only what they list. Not medical advice — practical home cooking.

INGREDIENTS AVAILABLE (use only these plus pantry basics: salt, pepper, oil spray, common spices):
${ingredients}

THIS MEAL'S MACRO TARGETS (each idea should be close — within ~15% per macro when possible):
- calories: ${meal_targets.calories} kcal
- protein_g: ${meal_targets.protein_g}
- fat_g: ${meal_targets.fat_g}
- carbs_g: ${meal_targets.carbs_g}

CONTEXT TODAY:
- Daily calorie goal: ${daily.calories}
- Already eaten today: ${Math.round(consumed.calories)} kcal, ${Math.round(consumed.protein_g)}g protein, ${Math.round(consumed.fat_g)}g fat, ${Math.round(consumed.carbs_g)}g carbs
- Remaining today after this meal should still be plausible (don't suggest blowing the whole day in one dish unless targets allow it).

RULES:
1. Return exactly 3 or 4 different meal ideas (not a weekly plan).
2. Each idea must primarily use the listed ingredients.
3. Give realistic home portions; estimates are approximate.
4. recipe_search_query: short Google search phrase only (e.g. "grilled chicken rice bowl recipe"). Do NOT output URLs.
5. No shopping lists for specialty items not in the ingredient list.

Respond in JSON only.`;

    const url = `${GEMINI_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: MEAL_IDEAS_JSON_SCHEMA,
        },
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message ?? "Gemini request failed";
      const isQuota = res.status === 429 || /\bquota\b/i.test(msg);
      return NextResponse.json(
        { error: isQuota ? "API rate limit reached. Wait a minute and try again." : msg },
        { status: isQuota ? 429 : res.status >= 400 ? res.status : 502 }
      );
    }

    const text = concatGeminiCandidateText(data);
    const ideas = parseMealIdeas(text);
    if (!ideas) {
      console.error("[macro-meal-machine] parse failed:", text.slice(0, 1500));
      return NextResponse.json({ error: "Could not read meal ideas. Try again or rephrase ingredients." }, { status: 502 });
    }

    return NextResponse.json({
      ideas,
      meal_targets,
      remaining_today: {
        calories: Math.round(remaining.calories),
        protein_g: Math.round(remaining.protein_g),
        fat_g: Math.round(remaining.fat_g),
        carbs_g: Math.round(remaining.carbs_g),
      },
    });
  } catch (err) {
    console.error("[macro-meal-machine]", err);
    return NextResponse.json({ error: "Failed to generate meal ideas" }, { status: 500 });
  }
}