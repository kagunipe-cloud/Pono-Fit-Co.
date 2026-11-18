/** Macro Meal Machine — meal budget math (shared by API + UI). */

export type MacroTotals = {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type DailyMacroGoals = MacroTotals & {
  protein_pct: number | null;
  fat_pct: number | null;
  carbs_pct: number | null;
};

export const MEAL_FRACTION_OPTIONS = [
  { value: 0.2, label: "⅕ of today’s plan" },
  { value: 0.25, label: "¼ of today’s plan" },
  { value: 1 / 3, label: "⅓ of today’s plan" },
  { value: 0.5, label: "½ of today’s plan" },
] as const;

export function macroGramGoalsFromGoals(
  calories_goal: number | null,
  protein_pct: number | null,
  fat_pct: number | null,
  carbs_pct: number | null
): MacroTotals | null {
  const cal = calories_goal ?? 0;
  if (cal <= 0) return null;
  const pPct = (protein_pct ?? 0) / 100;
  const fPct = (fat_pct ?? 0) / 100;
  const cPct = (carbs_pct ?? 0) / 100;
  return {
    calories: cal,
    protein_g: (pPct * cal) / 4,
    fat_g: (fPct * cal) / 9,
    carbs_g: (cPct * cal) / 4,
  };
}

export function macroRemaining(daily: MacroTotals, consumed: MacroTotals): MacroTotals {
  return {
    calories: Math.max(0, daily.calories - consumed.calories),
    protein_g: Math.max(0, daily.protein_g - consumed.protein_g),
    fat_g: Math.max(0, daily.fat_g - consumed.fat_g),
    carbs_g: Math.max(0, daily.carbs_g - consumed.carbs_g),
  };
}

/** Prefill this meal’s targets: fraction × daily, capped by what’s left today. */
export function computeMealPrefill(daily: MacroTotals, consumed: MacroTotals, fraction: number): MacroTotals {
  const remaining = macroRemaining(daily, consumed);
  const round = (n: number) => Math.max(0, Math.round(n));
  return {
    calories: round(Math.min(remaining.calories, daily.calories * fraction)),
    protein_g: round(Math.min(remaining.protein_g, daily.protein_g * fraction)),
    fat_g: round(Math.min(remaining.fat_g, daily.fat_g * fraction)),
    carbs_g: round(Math.min(remaining.carbs_g, daily.carbs_g * fraction)),
  };
}

export function clampMealTargetsToRemaining(targets: MacroTotals, remaining: MacroTotals): MacroTotals {
  return {
    calories: Math.min(Math.max(0, targets.calories), Math.ceil(remaining.calories)),
    protein_g: Math.min(Math.max(0, targets.protein_g), Math.ceil(remaining.protein_g)),
    fat_g: Math.min(Math.max(0, targets.fat_g), Math.ceil(remaining.fat_g)),
    carbs_g: Math.min(Math.max(0, targets.carbs_g), Math.ceil(remaining.carbs_g)),
  };
}

export function recipeSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

export type MealIdea = {
  name: string;
  summary: string;
  est_calories: number;
  est_protein_g: number;
  est_fat_g: number;
  est_carbs_g: number;
  recipe_search_query: string;
};