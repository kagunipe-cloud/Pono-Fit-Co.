/**
 * Food serving unit classification and conversion for journal entries.
 *
 * WEIGHT vs VOLUME vs SERVING (count):
 * - WEIGHT: g, oz, grm, mg — we convert to grams as the canonical base when doing math.
 * - VOLUME: cup, tbsp, tsp, ml, L, fl oz — we convert to ml as the base. USDA and OFF
 *   report nutrients per 100g (weight basis); when the package is marketed in volume
 *   (e.g. creamer in mL), we store serving in volume and use per-serving nutrients from
 *   the API when present (OFF energy-kcal_serving etc.). Without density we cannot
 *   convert volume→weight to scale from per-100g; an optional density_g_per_ml field
 *   would allow normalizing to weight for data sync while still displaying volume.
 * - SERVING: bar, cookie, slice, piece, etc. — amount = multiplier of that count.
 *
 * Diary display: We show the unit users see on the package (e.g. oz for weight, fl oz/mL
 * for liquids) so "2 fl oz" and "59 mL" match the label. Internally we store amount =
 * multiplier of the food's serving; for volume foods we keep serving in mL and ensure
 * nutrients are per that serving so calories stay correct.
 */

export type UnitType = "weight" | "volume" | "serving";

const OZ_TO_G = 28.349523125;
// US volume in ml
const CUP_ML = 236.588;
const TBSP_ML = 14.787;
const TSP_ML = 4.929;
const FL_OZ_ML = 29.574;
const LITER_ML = 1000;

/** Normalize unit string for comparison (lowercase, strip trailing 's'). */
function norm(u: string): string {
  return String(u).toLowerCase().trim().replace(/s$/, "");
}

const G_TO_OZ = 1 / 28.349523125;

/** Format serving for display. When source gives weight in grams, show oz so it matches the package (e.g. 150 g → 5.3 oz). Otherwise show value + normalized unit label (e.g. GRM → g, OZ → oz). */
export function formatServingForDisplay(value: number, unit: string | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  const u = String(unit ?? "").trim();
  if (!u) return String(value);
  const lower = u.toLowerCase();
  if (lower === "grm" || lower === "gram" || lower === "grams" || lower === "g") {
    const oz = Math.round(value * G_TO_OZ * 10) / 10;
    return `${oz} oz`;
  }
  if (lower === "oz" || lower === "ounce" || lower === "ounces") return `${value} oz`;
  if (lower === "mg") return `${value} mg`;
  if (lower === "cup" || lower === "cups") return `${value} cup`;
  if (lower === "tbsp" || lower === "tablespoon") return `${value} tbsp`;
  if (lower === "tsp" || lower === "teaspoon") return `${value} tsp`;
  if (lower === "ml" || lower === "milliliter" || lower === "mlt") return `${value} mL`;
  if (lower === "l" || lower === "liter") return `${value} L`;
  return `${value} ${u}`;
}

/**
 * Fix impossible serving data (e.g. USDA "30 mg" at 400 cal → treat as "30 g").
 * When unit is "mg" and the implied calories per 100g would exceed ~900 kcal (impossible for food),
 * assume the unit was meant to be "g" and return corrected size and unit.
 */
export function normalizeServingSizeAndUnit(
  size: number | null,
  unit: string | null | undefined,
  caloriesPerServing: number | null
): { size: number | null; unit: string | null } {
  if (size == null || size <= 0) return { size, unit: unit ?? null };
  const u = norm(unit ?? "");
  if (u !== "mg" && u !== "milligram") return { size, unit: unit ?? null };
  if (typeof caloriesPerServing !== "number" || caloriesPerServing <= 0) return { size, unit: unit ?? null };
  // Serving in mg → grams = size/1000. Cal per 100g = caloriesPerServing / (size/1000) * 100 = caloriesPerServing * 100000 / size
  const calPer100g = (caloriesPerServing * 100_000) / size;
  const MAX_PLAUSIBLE_CAL_PER_100G = 900; // pure fat ~900 kcal/100g
  if (calPer100g > MAX_PLAUSIBLE_CAL_PER_100G) {
    return { size, unit: "g" };
  }
  return { size, unit: unit ?? null };
}

/** Classify a food's serving_size_unit into weight, volume, or serving (count). */
export function getUnitType(unit: string | null | undefined): UnitType {
  const u = norm(unit ?? "");
  if (!u) return "serving";

  const weight = ["g", "gram", "grams", "grm", "mg", "milligram", "oz", "ounce"];
  if (weight.includes(u)) return "weight";

  const volume = [
    "cup", "tablespoon", "tbsp", "teaspoon", "tsp",
    "ml", "milliliter", "mlt", "l", "liter", "fluid ounce", "fl oz",
    "ounce", // fl oz often just "oz" in volume context — USDA uses "cup", "tbsp", etc.
  ];
  if (volume.includes(u)) return "volume";

  // Count/serving: bar, cookie, serving, piece, slice, etc.
  return "serving";
}

/** User-facing measurement options per unit type. "servings" = one full serving as defined by the food. */
export const MEASUREMENT_OPTIONS: Record<UnitType, { value: string; label: string }[]> = {
  weight: [
    { value: "servings", label: "serving(s)" },
    { value: "g", label: "grams" },
    { value: "oz", label: "oz" },
  ],
  volume: [
    { value: "servings", label: "serving(s)" },
    { value: "oz", label: "oz" },
    { value: "L", label: "liter(s)" },
    { value: "mL", label: "milliliter(s)" },
    { value: "tsp", label: "teaspoon(s)" },
    { value: "tbsp", label: "tablespoon(s)" },
    { value: "cup", label: "cup(s)" },
  ],
  serving: [
    { value: "servings", label: "serving(s)" },
  ],
};

/**
 * For serving-type foods, get measurement options from the food's unit (e.g. slice/slices, cookie/cookies).
 * Use this when the food has a specific count unit so the user can pick "slice" or "slices", etc.
 */
export function getServingMeasurementOptions(unit: string | null | undefined): { value: string; label: string }[] {
  const raw = String(unit ?? "").trim();
  const singular = raw ? norm(raw) : "serving";
  if (!singular) return MEASUREMENT_OPTIONS.serving;
  const plural = singular + "s";
  return [
    { value: singular, label: singular },
    { value: plural, label: plural },
  ];
}

/** Convert a single unit value to grams (for weight). Returns null if not a weight unit. */
export function unitToGrams(value: number, unit: string): number | null {
  const u = norm(unit);
  if (u === "g" || u === "gram" || u === "grams" || u === "grm") return value;
  if (u === "mg" || u === "milligram") return value / 1000;
  if (u === "oz" || u === "ounce") return value * OZ_TO_G;
  return null;
}

/** Convert a single unit value to ml (for volume). Returns null if not a volume unit. */
export function unitToMl(value: number, unit: string): number | null {
  const u = norm(unit);
  if (u === "g" || u === "gram" || u === "oz" || u === "ounce") return null; // weight oz
  if (u === "cup") return value * CUP_ML;
  if (u === "tablespoon" || u === "tbsp") return value * TBSP_ML;
  if (u === "teaspoon" || u === "tsp") return value * TSP_ML;
  if (u === "ml" || u === "milliliter" || u === "mlt") return value;
  if (u === "l" || u === "liter") return value * LITER_ML;
  if (u === "fluid ounce" || u === "fl oz") return value * FL_OZ_ML;
  // USDA sometimes uses "oz" for fluid oz in volume context
  if (u === "oz") return value * FL_OZ_ML;
  return null;
}

/**
 * Compute the journal entry "amount" (multiplier of serving) from user input.
 * - quantity: number user entered
 * - measurement: one of MEASUREMENT_OPTIONS[].value (g, oz, cup, servings, etc.)
 * - servingSize, servingUnit: food's serving size and unit from DB
 * Returns null if conversion not possible (e.g. wrong unit type).
 */
export function quantityAndMeasurementToAmount(
  quantity: number,
  measurement: string,
  servingSize: number | null,
  servingUnit: string | null
): number | null {
  if (quantity <= 0) return null;
  const m = measurement.toLowerCase().trim();
  const type = getUnitType(servingUnit);
  const size = servingSize ?? 1;
  const unit = servingUnit ?? "";

  if (type === "serving") {
    return quantity;
  }

  if (type === "weight") {
    if (m === "servings" || m === "serving") return quantity;
    const userGrams = m === "g" ? quantity : m === "oz" ? quantity * OZ_TO_G : null;
    if (userGrams == null) return null;
    const servingGrams = unitToGrams(size, unit);
    if (servingGrams == null || servingGrams <= 0) return quantity; // fallback to quantity as multiplier
    return userGrams / servingGrams;
  }

  if (type === "volume") {
    if (m === "servings" || m === "serving") return quantity;
    let userMl: number | null = null;
    if (m === "oz") userMl = quantity * FL_OZ_ML;
    else if (m === "l") userMl = quantity * LITER_ML;
    else if (m === "ml") userMl = quantity;
    else if (m === "tsp") userMl = quantity * TSP_ML;
    else if (m === "tbsp") userMl = quantity * TBSP_ML;
    else if (m === "cup") userMl = quantity * CUP_ML;
    if (userMl == null) return null;
    const servingMl = unitToMl(size, unit);
    if (servingMl == null || servingMl <= 0) return quantity;
    return userMl / servingMl;
  }

  return quantity;
}

/** Format a display label for portion (e.g. " — 50 g" or " × 2 serving(s)"). */
export function formatPortionLabel(
  amount: number,
  servingSize: number | null,
  servingUnit: string | null
): string {
  if (servingSize == null || servingUnit == null || servingSize <= 0) {
    const word = amount === 1 ? "serving" : "serving(s)";
    return ` × ${amount} ${word}`;
  }
  const u = norm(servingUnit);
  const total = amount * servingSize;

  if (u === "g" || u === "gram" || u === "grams" || u === "grm") return ` — ${(total * G_TO_OZ).toFixed(1)} oz`;
  if (u === "mg" || u === "milligram") return ` — ${Math.round(total)} mg`;
  if (u === "oz" || u === "ounce") {
    const type = getUnitType(servingUnit);
    if (type === "volume") return ` — ${total.toFixed(1)} fl oz`;
    return ` — ${total.toFixed(1)} oz`;
  }
  if (unitToMl(1, servingUnit) != null) {
    if (u === "ml" || u === "milliliter" || u === "mlt") return ` — ${Math.round(total)} mL`;
    if (u === "l" || u === "liter") return ` — ${total.toFixed(2)} L`;
    if (u === "cup") return ` — ${total.toFixed(2)} cup(s)`;
    if (u === "tablespoon" || u === "tbsp") return ` — ${total.toFixed(1)} tbsp`;
    if (u === "teaspoon" || u === "tsp") return ` — ${total.toFixed(1)} tsp`;
    return ` × ${amount} ${servingUnit}`;
  }
  // Count/serving units: use plural when amount !== 1 (e.g. "2 slices")
  const plural = u + "s";
  const unitWord = amount === 1 ? u : plural;
  return ` × ${amount} ${unitWord}`;
}
