/**
 * Macro sanity checks and data-quality flags for foods.
 * Use on all incoming data (USDA, OFF, manual, import) to flag or fix impossible values.
 */

export type MacroInput = {
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  fiber_g?: number | null;
};

export type ValidationResult = {
  valid: boolean;
  issues: string[];
  /** Suggested calories from 4*P + 9*F + 4*C (fiber optional 2*Fiber) */
  suggestedCalories: number | null;
  /** Data quality flags to store: macro_mismatch, negative_macros, impossible_density, cross_referenced */
  dataQualityFlags: string[];
};

const CALORIES_TOLERANCE_PERCENT = 15;
const MAX_PLAUSIBLE_CAL_PER_100G = 900;

/**
 * Validate macros: do they add up? Any negative or impossible values?
 * Returns issues and optional suggested calories (from 4P+9F+4C).
 */
export function validateMacros(macros: MacroInput): ValidationResult {
  const issues: string[] = [];
  const flags: string[] = [];
  const { calories, protein_g, fat_g, carbs_g, fiber_g } = macros;

  const p = protein_g ?? 0;
  const f = fat_g ?? 0;
  const c = carbs_g ?? 0;
  const fib = fiber_g ?? 0;

  if (p < 0 || f < 0 || c < 0 || fib < 0) {
    issues.push("Negative macro value");
    flags.push("negative_macros");
  }

  // Expected calories: 4*protein + 9*fat + 4*carbs (fiber often counted as 2 kcal/g or 0)
  const expectedFromMacros = 4 * p + 9 * f + 4 * c;
  const suggestedCalories = expectedFromMacros > 0 ? Math.round(expectedFromMacros) : null;

  if (expectedFromMacros > 0 && (calories == null || calories === 0)) {
    issues.push("Missing calories (macros present; expected ~" + (suggestedCalories ?? 0) + " from 4P+9F+4C)");
    flags.push("missing_calories");
  }

  if (typeof calories === "number" && calories > 0 && suggestedCalories != null && suggestedCalories > 0) {
    const diff = Math.abs(calories - suggestedCalories);
    const pct = (diff / suggestedCalories) * 100;
    if (pct > CALORIES_TOLERANCE_PERCENT) {
      issues.push(
        `Calories (${calories}) don't match macros (expected ~${suggestedCalories} from 4P+9F+4C)`
      );
      flags.push("macro_mismatch");
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    suggestedCalories,
    dataQualityFlags: flags,
  };
}

/**
 * Check if calories per 100g are impossible (e.g. > 900 for non-fat foods).
 * Pass serving in grams (or 100 if values are per 100g).
 */
export function checkCaloriesDensity(
  caloriesPerServing: number | null,
  servingGrams: number | null
): { ok: boolean; issue?: string; flag?: string } {
  if (
    caloriesPerServing == null ||
    caloriesPerServing <= 0 ||
    servingGrams == null ||
    servingGrams <= 0
  ) {
    return { ok: true };
  }
  const calPer100g = (caloriesPerServing / servingGrams) * 100;
  if (calPer100g > MAX_PLAUSIBLE_CAL_PER_100G) {
    return {
      ok: false,
      issue: `Calories per 100g (${Math.round(calPer100g)}) exceed plausible maximum (~900)`,
      flag: "impossible_density",
    };
  }
  return { ok: true };
}

/**
 * Combine macro validation + optional density check into one result.
 * Use when you have serving size so we can flag impossible density.
 */
export function validateFood(
  macros: MacroInput,
  options?: { servingSizeGrams?: number | null }
): ValidationResult {
  const result = validateMacros(macros);
  const cal = macros.calories;
  if (
    options?.servingSizeGrams != null &&
    options.servingSizeGrams > 0 &&
    typeof cal === "number" &&
    cal > 0
  ) {
    const density = checkCaloriesDensity(cal, options.servingSizeGrams);
    if (!density.ok) {
      result.issues.push(density.issue!);
      if (density.flag && !result.dataQualityFlags.includes(density.flag)) {
        result.dataQualityFlags.push(density.flag);
      }
      result.valid = false;
    }
  }
  return result;
}

/** Serialize data_quality flags for DB storage (comma-separated or JSON). */
export function serializeDataQuality(flags: string[]): string | null {
  if (flags.length === 0) return null;
  return flags.join(",");
}

/** Parse stored data_quality string back to flags. */
export function parseDataQuality(stored: string | null | undefined): string[] {
  if (stored == null || typeof stored !== "string") return [];
  return stored.split(",").map((s) => s.trim()).filter(Boolean);
}
