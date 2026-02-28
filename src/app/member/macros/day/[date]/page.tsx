"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatDateOnlyInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import { getUnitType, MEASUREMENT_OPTIONS, getServingMeasurementOptions, formatPortionLabel, formatServingForDisplay, unitToGrams } from "@/lib/food-units";
import { validateMacros } from "@/lib/food-quality";

type Food = { id: number; name: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; serving_size?: number | null; serving_size_unit?: string | null; serving_description?: string | null; nutrients_per_100g?: number | null; source?: string };
type USDAFoodNutrient = { nutrientId?: number; nutrient?: { id?: number }; nutrientName?: string; unitName?: string; value?: number; amount?: number };
type USDAFoodHit = { fdcId: number; description?: string; foodNutrients?: USDAFoodNutrient[]; servingSize?: number; servingSizeUnit?: string; dataType?: string };

function usdaMacros(food: USDAFoodHit): { cal: number | null; p: number | null; f: number | null; c: number | null } {
  const nutrients = food.foodNutrients ?? [];
  const byId: Record<number, number> = {};
  for (const n of nutrients) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const val = n.value ?? n.amount;
    if (typeof id === "number" && typeof val === "number") byId[id] = val;
  }
  return {
    cal: byId[1008] ?? null,
    p: byId[1003] ?? null,
    f: byId[1004] ?? null,
    c: byId[1005] ?? null,
  };
}

type Entry = { id: number; food_id: number; amount: number; sort_order: number; quantity?: number | null; measurement?: string | null; food: Food | null };
type Meal = { id: number; journal_day_id: number; name: string; sort_order: number; entries: Entry[] };
type DayData = { id: number; member_id: string; date: string; created_at: string; meals: Meal[] };
type Favorite = { id: number; name: string; items: { food_id: number; amount: number; food_name: string }[] };
type OFFSearchFood = { name: string; barcode: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; serving_size: number | null; serving_size_unit: string | null; serving_description: string | null };

type SearchHit = { source: "usda"; data: USDAFoodHit } | { source: "off"; data: OFFSearchFood };

/** USDA foodPortions entry from GET food/{fdcId}. Used only for USDA foods to offer tbsp/tsp/cup. */
type USDAFoodPortion = { portionDescription?: string; amount?: number; gramWeight?: number };
/** Parsed tbsp/tsp/cup/fl oz portions: gramWeight is grams per 1 unit. USDA-only. */
type USDAVolumePortions = { tbsp?: { gramWeight: number }; tsp?: { gramWeight: number }; cup?: { gramWeight: number }; flOz?: { gramWeight: number } };

function parseUsdaVolumePortions(portions: USDAFoodPortion[] | null | undefined): USDAVolumePortions | null {
  if (!Array.isArray(portions) || portions.length === 0) return null;
  const out: USDAVolumePortions = {};
  for (const p of portions) {
    const desc = String(p.portionDescription ?? "").toLowerCase();
    const amount = typeof p.amount === "number" && p.amount > 0 ? p.amount : 1;
    const gw = typeof p.gramWeight === "number" && p.gramWeight > 0 ? p.gramWeight : null;
    if (gw == null) continue;
    const gramsPerUnit = gw / amount;
    if ((desc.includes("tablespoon") || desc.includes("tbsp")) && !out.tbsp) out.tbsp = { gramWeight: gramsPerUnit };
    if ((desc.includes("teaspoon") || desc.includes("tsp")) && !out.tsp) out.tsp = { gramWeight: gramsPerUnit };
    if (desc.includes("cup") && !out.cup) out.cup = { gramWeight: gramsPerUnit };
    if ((desc.includes("fluid ounce") || desc.includes("fl oz") || (desc.includes("ounce") && desc.includes("fluid"))) && !out.flOz) out.flOz = { gramWeight: gramsPerUnit };
  }
  return out.tbsp || out.tsp || out.cup || out.flOz ? out : null;
}

/** Exclude names that contain non-Latin scripts or look like French so we show English-only. */
function isLikelyEnglish(name: string): boolean {
  const s = String(name ?? "").trim();
  if (!s) return false;
  const nonLatin =
    /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0590-\u05FF]/u;
  if (nonLatin.test(s)) return false;
  const lower = s.toLowerCase();
  // French-only or strongly French words (word boundary) — exclude so we don't show French results. Avoid English overlaps (e.g. "sauce", "cream").
  const frenchWord =
    /\b(avec|pour|sans|dans|les\b|des\b|une\b|du\b|au\b|aux\b|ingrédients|matières|matieres|grasses|glucides|protéines|proteines|fromage|beurre)\b/i;
  if (frenchWord.test(lower)) return false;
  // "énergie" / "energie" in nutrition context is usually French
  if (/\b(énergie|energie)\b/i.test(lower)) return false;
  // French-style "X et Y" / "X ou Y" or "et/ou" with article is very common in French labels
  if (/\bet\b.*\bou\b/i.test(lower) || /\b(ou|et)\s+(le|la|les|un|une|des|du|de)\b/i.test(lower)) return false;
  return true;
}

/** Higher = better match. Used to sort merged results. */
function scoreRelevance(name: string, query: string): number {
  const n = String(name ?? "").toLowerCase().trim();
  const q = String(query ?? "").toLowerCase().trim();
  if (!q) return 50;
  if (n === q) return 100;
  if (n.startsWith(q)) return 85;
  const qWords = q.split(/\s+/).filter(Boolean);
  const allWordsInName = qWords.every((w) => n.includes(w));
  if (allWordsInName && qWords.length > 0) return 70;
  // Single-word query matching as whole word (e.g. "oreo" in "Nabisco Oreo Cookies") — boost above plain "includes" so branded products rank well
  if (qWords.length === 1 && qWords[0]) {
    const word = qWords[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wholeWordRe = new RegExp("\\b" + word + "\\b", "i");
    if (wholeWordRe.test(n)) return 86;
  }
  if (n.includes(q)) return 60;
  const someWords = qWords.filter((w) => n.includes(w)).length;
  return someWords / Math.max(1, qWords.length) * 40;
}

/** True when the hit has a weight or volume serving (e.g. 4.9 oz, 150 g, 15 ml). Prefer these over vague "1 serving" so results stay consistent across query typos. */
function hasConcreteServingSize(hit: SearchHit): boolean {
  if (hit.source === "usda") {
    const f = hit.data;
    const size = f.servingSize;
    const unit = f.servingSizeUnit;
    if (size == null || unit == null || size <= 0) return false;
    const type = getUnitType(unit);
    return type === "weight" || type === "volume";
  }
  const f = hit.data;
  const size = f.serving_size;
  const unit = f.serving_size_unit;
  if (size == null || unit == null || size <= 0) return false;
  const type = getUnitType(unit);
  return type === "weight" || type === "volume";
}

/** True when the hit has at least one non-zero macro (calories, protein, fat, or carbs). Exclude all-zero so we don't show useless results. */
function hasAnyMacros(hit: SearchHit): boolean {
  if (hit.source === "usda") {
    const m = usdaMacros(hit.data);
    const cal = m.cal ?? 0;
    const p = m.p ?? 0;
    const f = m.f ?? 0;
    const c = m.c ?? 0;
    return cal > 0 || p > 0 || f > 0 || c > 0;
  }
  const f = hit.data;
  const cal = f.calories ?? 0;
  const p = f.protein_g ?? 0;
  const fat = f.fat_g ?? 0;
  const c = f.carbs_g ?? 0;
  return cal > 0 || p > 0 || fat > 0 || c > 0;
}

/** Exclude entries that have P/F/C but no calories (incomplete data). */
function hasReasonableCalories(hit: SearchHit): boolean {
  if (hit.source === "usda") {
    const m = usdaMacros(hit.data);
    const cal = m.cal ?? 0;
    const p = m.p ?? 0;
    const f = m.f ?? 0;
    const c = m.c ?? 0;
    if (p > 0 || f > 0 || c > 0) return cal > 0;
    return true;
  }
  const f = hit.data;
  const cal = f.calories ?? 0;
  const p = f.protein_g ?? 0;
  const fat = f.fat_g ?? 0;
  const c = f.carbs_g ?? 0;
  if (p > 0 || fat > 0 || c > 0) return cal > 0;
  return true;
}

/** True when we would wrongly show per-100g as per-serving (volume serving, no density). Exclude these so we never show e.g. "133 cal for 15 ml". */
function wouldShowImpossiblePerServingCal(hit: SearchHit): boolean {
  if (hit.source === "usda") {
    const f = hit.data;
    const size = f.servingSize;
    const unit = f.servingSizeUnit;
    if (size == null || unit == null) return false;
    if (getUnitType(unit) !== "volume") return false;
    const grams = unitToGrams(size, unit);
    return grams == null;
  }
  const f = hit.data;
  const size = f.serving_size;
  const unit = f.serving_size_unit;
  if (size == null || unit == null) return false;
  if (getUnitType(unit) !== "volume") return false;
  const grams = unitToGrams(size, unit);
  return grams == null;
}

function entryMacros(e: Entry): { cal: number; p: number; f: number; c: number } {
  const f = e.food;
  if (!f) return { cal: 0, p: 0, f: 0, c: 0 };
  const a = e.amount;
  return {
    cal: (f.calories ?? 0) * a,
    p: (f.protein_g ?? 0) * a,
    f: (f.fat_g ?? 0) * a,
    c: (f.carbs_g ?? 0) * a,
  };
}

/** Format measurement for diary display (e.g. "tbsp" → "tbsp", "servings" → "serving(s)"). */
function formatMeasurementLabel(measurement: string): string {
  const m = measurement.toLowerCase().trim().replace(/s$/, "");
  if (m === "serving") return "serving(s)";
  if (m === "tbsp" || m === "tablespoon") return "tbsp";
  if (m === "cup") return "cup(s)";
  if (m === "tsp" || m === "teaspoon") return "tsp";
  if (m === "g" || m === "gram") return "g";
  if (m === "oz" || m === "ounce") return "oz";
  return measurement;
}

function entryPortionLabel(e: Entry): string {
  if (e.quantity != null && e.quantity > 0 && e.measurement) {
    const q = e.quantity === Math.round(e.quantity) ? String(Math.round(e.quantity)) : String(e.quantity);
    return ` — ${q} ${formatMeasurementLabel(e.measurement)}`;
  }
  const f = e.food;
  if (!f) {
    const word = e.amount === 1 ? "serving" : "serving(s)";
    return ` × ${e.amount} ${word}`;
  }
  // AI/calculated foods: amount=1 with serving_description (e.g. "4 oz") — show that for display
  if (e.amount === 1 && f.serving_description?.trim()) {
    return ` — ${f.serving_description.trim()}`;
  }
  return formatPortionLabel(e.amount, f.serving_size ?? null, f.serving_size_unit ?? null);
}

function sumMacros(entries: Entry[]) {
  return entries.reduce(
    (acc, e) => {
      const m = entryMacros(e);
      acc.cal += m.cal;
      acc.p += m.p;
      acc.f += m.f;
      acc.c += m.c;
      return acc;
    },
    { cal: 0, p: 0, f: 0, c: 0 }
  );
}

/** Mountain (mauna) tracker: fills from bottom; over goal = red lava overflow */
function MaunaTracker({
  label,
  current,
  goal,
  unit,
  fillColor = "bg-brand-500",
}: {
  label: string;
  current: number;
  goal: number;
  unit: string;
  fillColor?: string;
}) {
  const hasGoal = goal > 0;
  const fillPct = hasGoal ? Math.min(100, (current / goal) * 100) : 0;
  const isOver = hasGoal && current > goal;
  const overflowPct = hasGoal && goal > 0 ? Math.min(50, ((current - goal) / goal) * 100) : 0; // cap overflow height at 50% of mountain

  return (
    <div className="flex flex-col items-center">
      <div className="flex justify-between w-full text-xs text-stone-500 mb-1">
        <span className="font-medium text-stone-600">{label}</span>
        <span>
          {unit === "cal" ? Math.round(current).toLocaleString() : Math.round(current)}
          {hasGoal ? ` / ${unit === "cal" ? Math.round(goal).toLocaleString() : Math.round(goal)}${unit}` : unit}
        </span>
      </div>
      <div className="w-full relative" style={{ height: 88 }}>
        {/* Lava overflow (when over goal) */}
        {isOver && overflowPct > 0 && (
          <div
            className="absolute left-0 right-0 rounded-t-lg bg-red-500 border-2 border-red-600 shadow-lg transition-all"
            style={{
              bottom: "100%",
              height: `${overflowPct}%`,
              minHeight: 8,
            }}
            title={`${Math.round(current - goal)} ${unit} over`}
          />
        )}
        {/* Mountain shape: trapezoid (wider at base) */}
        <div
          className="absolute inset-x-0 bottom-0 overflow-hidden rounded-b-lg bg-stone-200"
          style={{
            height: "100%",
            clipPath: "polygon(8% 100%, 50% 8%, 92% 100%)",
          }}
        >
          {/* Fill from bottom */}
          <div
            className={`absolute left-0 right-0 bottom-0 transition-all duration-500 ${isOver ? "bg-red-500" : fillColor}`}
            style={{
              height: `${isOver ? 100 : fillPct}%`,
              clipPath: "polygon(8% 100%, 50% 8%, 92% 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function MemberMacrosDayPage() {
  const params = useParams();
  const router = useRouter();
  const tz = useAppTimezone();
  const date = params.date as string;
  const [day, setDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [addMealName, setAddMealName] = useState("");
  const [addingMeal, setAddingMeal] = useState(false);
  const [addFoodMealId, setAddFoodMealId] = useState<number | null>(null);
  const [foodSearch, setFoodSearch] = useState("");
  const [mergedSearchResults, setMergedSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchQueryRef = useRef("");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [selectedUsdaFood, setSelectedUsdaFood] = useState<USDAFoodHit | null>(null);
  /** USDA-only: tbsp/cup portion data from full food details (foodPortions). Used for measurement options and portion_grams. */
  const [selectedUsdaPortions, setSelectedUsdaPortions] = useState<USDAVolumePortions | null>(null);
  const [selectedOffFood, setSelectedOffFood] = useState<OFFSearchFood | null>(null);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("1");
  const [addMeasurement, setAddMeasurement] = useState<string>("servings");
  const [addingEntry, setAddingEntry] = useState(false);
  const [editEntryId, setEditEntryId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [saveFavName, setSaveFavName] = useState("");
  const [saveFavFromEntry, setSaveFavFromEntry] = useState<{ food_id: number; amount: number } | null>(null);
  const [saveFavFromMealId, setSaveFavFromMealId] = useState<number | null>(null);
  const [deletingDay, setDeletingDay] = useState(false);
  const [aiFood, setAiFood] = useState("");
  const [aiPortionValue, setAiPortionValue] = useState("1");
  const [aiPortionUnit, setAiPortionUnit] = useState("");
  const [aiCalculating, setAiCalculating] = useState(false);
  const [aiResult, setAiResult] = useState<{ calories: number; protein_g: number; fat_g: number; carbs_g: number } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [addingAiEntry, setAddingAiEntry] = useState(false);
  const [goals, setGoals] = useState<{ calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null }>({ calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null });
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [showShare, setShowShare] = useState(false);

  const AI_PORTION_UNITS = [
    { value: "", label: "—" },
    { value: "serving", label: "serving(s)" },
    { value: "tablespoon", label: "tablespoon(s)" },
    { value: "teaspoon", label: "teaspoon(s)" },
    { value: "cup", label: "cup(s)" },
    { value: "gram", label: "gram(s)" },
    { value: "oz", label: "oz" },
  ];

  const fetchDay = useCallback(() => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setLoading(true);
    fetch(`/api/member/journal/days/${date}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        if (res.status === 404) return null;
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data) setDay(data);
        else {
          fetch(`/api/member/journal/days`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
          }).then((r) => {
            if (r.ok) fetchDay();
          });
        }
      })
      .catch(() => setDay(null))
      .finally(() => setLoading(false));
  }, [date, router]);

  useEffect(() => {
    fetchDay();
  }, [fetchDay]);

  useEffect(() => {
    fetch("/api/member/macro-goals")
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => g && setGoals(g))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (addFoodMealId != null) {
      fetch("/api/member/favorites")
        .then((r) => (r.ok ? r.json() : []))
        .then((list: Favorite[]) => setFavorites(Array.isArray(list) ? list : []))
        .catch(() => setFavorites([]));
    }
  }, [addFoodMealId]);

  /** Merge USDA + OFF lists, filter, score, sort. Used so we can show results as each source arrives. */
  function mergeAndSortHits(usdaList: USDAFoodHit[], offList: OFFSearchFood[], query: string): SearchHit[] {
    const usdaFiltered = usdaList.filter((f) => {
      const d = (f.description ?? "").trim();
      if (!d || d.toLowerCase() === "unknown" || d.toLowerCase() === "unknown food") return false;
      return isLikelyEnglish(d);
    });
    const offFiltered = offList.filter((f) => {
      const n = (f.name ?? "").trim();
      if (!n) return false;
      const nLower = n.toLowerCase();
      if (nLower === "unknown product" || nLower === "unknown products") return false;
      if (nLower.startsWith("unknown product ") || nLower.startsWith("unknown products ")) return false;
      if (!isLikelyEnglish(n)) return false;
      return true;
    });
    const usdaHits: SearchHit[] = usdaFiltered.map((data) => ({ source: "usda", data }));
    const offHits: SearchHit[] = offFiltered.map((data) => ({ source: "off", data }));
    const safeHits = [...usdaHits, ...offHits]
      .filter((hit) => hasAnyMacros(hit))
      .filter((hit) => hasReasonableCalories(hit))
      .filter((hit) => !wouldShowImpossiblePerServingCal(hit));
    const scored = safeHits.map((hit) => {
      const name = hit.source === "usda" ? (hit.data.description ?? "") : hit.data.name;
      const relevance = scoreRelevance(name, query);
      const dataQualityBonus = hasConcreteServingSize(hit) ? 15 : 0;
      return { hit, score: relevance + dataQualityBonus };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.hit);
  }

  useEffect(() => {
    const q = foodSearch.trim();
    if (!q) {
      setMergedSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchQueryRef.current = q;
      // Fire both in parallel; show results as each returns so we're not blocked on the slower API
      fetch(`/api/foods/search-usda?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d: { foods?: USDAFoodHit[] }) => Array.isArray(d.foods) ? d.foods : [])
        .then((usdaList) => {
          if (searchQueryRef.current !== q) return;
          setMergedSearchResults((prev) => {
            const offSoFar = prev.filter((h): h is { source: "off"; data: OFFSearchFood } => h.source === "off").map((h) => h.data);
            return mergeAndSortHits(usdaList, offSoFar, q);
          });
        })
        .catch(() => { if (searchQueryRef.current === q) setMergedSearchResults((prev) => prev); })
        .finally(() => { if (searchQueryRef.current === q) setSearching(false); });

      fetch(`/api/foods/search-off?q=${encodeURIComponent(q)}&page_size=20`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d: { foods?: OFFSearchFood[] }) => Array.isArray(d.foods) ? d.foods : [])
        .then((offList) => {
          if (searchQueryRef.current !== q) return;
          setMergedSearchResults((prev) => {
            const usdaSoFar = prev.filter((h): h is { source: "usda"; data: USDAFoodHit } => h.source === "usda").map((h) => h.data);
            return mergeAndSortHits(usdaSoFar, offList, q);
          });
        })
        .catch(() => { if (searchQueryRef.current === q) setMergedSearchResults((prev) => prev); })
        .finally(() => { if (searchQueryRef.current === q) setSearching(false); });
    }, 400);
    return () => clearTimeout(t);
  }, [foodSearch]);

  async function handleAddMeal() {
    const name = addMealName.trim() || "Meal";
    setAddingMeal(true);
    try {
      const res = await fetch(`/api/member/journal/days/${date}/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setAddMealName("");
        fetchDay();
      }
    } finally {
      setAddingMeal(false);
    }
  }

  async function handleShareDay() {
    const email = shareEmail.trim().toLowerCase();
    if (!email) return;
    setShareResult(null);
    setSharing(true);
    try {
      const res = await fetch("/api/member/journal/send-to-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_email: email, date }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShareResult({ ok: true, message: (data as { message?: string }).message });
        setShareEmail("");
        setShowShare(false);
      } else {
        setShareResult({ ok: false, message: (data as { error?: string }).error ?? "Failed to share" });
      }
    } catch {
      setShareResult({ ok: false, message: "Something went wrong." });
    } finally {
      setSharing(false);
    }
  }

  async function handleAddEntry() {
    if (addFoodMealId == null) return;
    const meal = day?.meals.find((m) => m.id === addFoodMealId);
    if (!meal) return;
    setAddingEntry(true);
    try {
      if (selectedFavoriteId != null) {
        const res = await fetch(`/api/member/journal/meals/${addFoodMealId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ favorite_id: selectedFavoriteId }),
        });
        if (res.ok) {
          setAddFoodMealId(null);
          setSelectedUsdaFood(null);
          setSelectedFavoriteId(null);
          setFoodSearch("");
          setAddAmount("1");
          fetchDay();
        }
        return;
      }
      if (selectedUsdaFood != null) {
        // Get full details so we save complete nutrients (search often returns abridged)
        let usdaFood: USDAFoodHit = selectedUsdaFood;
        let portionsFromFetch: USDAVolumePortions | null = null;
        const fetchRes = await fetch(`/api/foods/fetch-usda?fdcId=${selectedUsdaFood.fdcId}`);
        if (fetchRes.ok) {
          const full = await fetchRes.json() as { fdcId?: number; foodPortions?: USDAFoodPortion[] };
          if (full?.fdcId != null) usdaFood = full as USDAFoodHit;
          portionsFromFetch = full?.foodPortions ? parseUsdaVolumePortions(full.foodPortions) : null;
        }
        // Use portion data from this fetch first (Survey/FNDDS often don't set selectedUsdaPortions on click)
        const portions = portionsFromFetch ?? selectedUsdaPortions;
        // Send gram weight for one serving so save-from-usda can scale nutrients correctly (fixes Survey/FNDDS "1 serving" and volume servings)
        let servingGrams: number | undefined;
        if (portions && usdaFood.servingSize != null && usdaFood.servingSizeUnit != null) {
          const u = String(usdaFood.servingSizeUnit).toLowerCase().replace(/s$/, "");
          const portion =
            (u === "tbsp" || u === "tablespoon") && portions.tbsp ? portions.tbsp
              : (u === "tsp" || u === "teaspoon") && portions.tsp ? portions.tsp
              : u === "cup" && portions.cup ? portions.cup
              : (u === "fl oz" || u === "fluid ounce") && portions.flOz ? portions.flOz
              : null;
          if (portion && "gramWeight" in portion) {
            servingGrams = usdaFood.servingSize * portion.gramWeight;
          } else if (getUnitType(usdaFood.servingSizeUnit) === "serving") {
            // Survey/FNDDS often use "1 serving" with nutrients per 100g — use tbsp as reference when we have it so we store per-tbsp
            const ref = portions.tbsp ?? portions.tsp ?? portions.cup ?? portions.flOz;
            if (ref && "gramWeight" in ref) servingGrams = usdaFood.servingSize * ref.gramWeight;
          }
        }
        // No foodPortions from API (common for Survey/FNDDS) — assume 1 serving ≈ 1 tbsp (21g) so we don't store 304 cal "per serving"
        if (servingGrams == null && usdaFood.servingSize === 1 && usdaFood.servingSizeUnit != null && getUnitType(usdaFood.servingSizeUnit) === "serving") {
          servingGrams = 21;
        }
        const saveBody = servingGrams != null ? { ...usdaFood, serving_grams: servingGrams } : usdaFood;
        const saveRes = await fetch("/api/foods/save-from-usda", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saveBody),
        });
        if (!saveRes.ok) {
          setAddingEntry(false);
          return;
        }
        const { id: foodId } = await saveRes.json() as { id: number };
        const num = parseFloat(addAmount) || 0;
        if (num <= 0) {
          setAddingEntry(false);
          return;
        }
        const volKey = addMeasurement === "fl oz" ? "flOz" : addMeasurement;
        const portionsForEntry = portions ?? selectedUsdaPortions;
        const usdaPortion = (addMeasurement === "tbsp" || addMeasurement === "tsp" || addMeasurement === "cup" || addMeasurement === "fl oz") && portionsForEntry?.[volKey as keyof typeof portionsForEntry];
        const entryBody = usdaPortion && "gramWeight" in usdaPortion
          ? { food_id: foodId, portion_grams: num * usdaPortion.gramWeight, quantity: num, measurement: addMeasurement }
          : { food_id: foodId, quantity: num, measurement: addMeasurement };
        const entryRes = await fetch(`/api/member/journal/meals/${addFoodMealId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entryBody),
        });
        if (entryRes.ok) {
          setAddFoodMealId(null);
          setSelectedUsdaFood(null);
          setSelectedUsdaPortions(null);
          setSelectedFavoriteId(null);
          setSelectedOffFood(null);
          setFoodSearch("");
          setAddAmount("1");
          setAddMeasurement("servings");
          fetchDay();
        }
        return;
      }
      if (selectedOffFood != null) {
        const saveRes = await fetch("/api/foods/save-from-off", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode: selectedOffFood.barcode }),
        });
        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({}));
          alert(err.error ?? "Failed to save product");
          setAddingEntry(false);
          return;
        }
        const { id: foodId } = await saveRes.json() as { id: number };
        const num = parseFloat(addAmount) || 0;
        if (num <= 0) {
          setAddingEntry(false);
          return;
        }
        const entryRes = await fetch(`/api/member/journal/meals/${addFoodMealId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ food_id: foodId, quantity: num, measurement: addMeasurement }),
        });
        if (entryRes.ok) {
          setAddFoodMealId(null);
          setSelectedUsdaFood(null);
          setSelectedOffFood(null);
          setSelectedFavoriteId(null);
          setFoodSearch("");
          setAddAmount("1");
          setAddMeasurement("servings");
          fetchDay();
        }
        return;
      }
    } finally {
      setAddingEntry(false);
    }
  }

  function openAddFood(mealId: number) {
    setAddFoodMealId(mealId);
    setSelectedUsdaFood(null);
    setSelectedUsdaPortions(null);
    setSelectedOffFood(null);
    setSelectedFavoriteId(null);
    setFoodSearch("");
    setAddAmount("1");
    setAddMeasurement("servings");
    setMergedSearchResults([]);
    setAiFood("");
    setAiPortionValue("1");
    setAiPortionUnit("");
    setAiResult(null);
    setAiError(null);
  }

  async function handleAiCalculate() {
    const food = aiFood.trim();
    if (!food) {
      setAiError("Enter a food name");
      return;
    }
    const val = parseFloat(aiPortionValue) || 1;
    if (val <= 0) {
      setAiError("Portion must be greater than 0");
      return;
    }
    setAiError(null);
    setAiResult(null);
    setAiCalculating(true);
    try {
      const res = await fetch("/api/ai/calculate-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ food, portionValue: val, portionUnit: aiPortionUnit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError((data.error as string) ?? "Failed to get macros");
        return;
      }
      setAiResult({
        calories: Number(data.calories) || 0,
        protein_g: Number(data.protein_g) || 0,
        fat_g: Number(data.fat_g) || 0,
        carbs_g: Number(data.carbs_g) || 0,
      });
    } finally {
      setAiCalculating(false);
    }
  }

  async function handleAddAiEntry() {
    if (addFoodMealId == null || !aiResult) return;
    const meal = day?.meals.find((m) => m.id === addFoodMealId);
    if (!meal) return;
    const foodName = aiFood.trim() || "AI food";
    const val = parseFloat(aiPortionValue) || 1;
    const unit = aiPortionUnit || "serving";
    const portionText = val === 1 ? `1 ${unit}` : `${val} ${unit}s`;
    setAddingAiEntry(true);
    try {
      const createRes = await fetch("/api/foods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: foodName,
          calories: aiResult.calories,
          protein_g: aiResult.protein_g,
          fat_g: aiResult.fat_g,
          carbs_g: aiResult.carbs_g,
          serving_description: portionText,
          source: "gemini",
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        alert((err.error as string) ?? "Failed to create food");
        return;
      }
      const { id: foodId } = (await createRes.json()) as { id: number };
      // AI result is already the total for the full portion (e.g. 4 oz = 136 cal). Store amount 1 so we don't double-multiply.
      const entryRes = await fetch(`/api/member/journal/meals/${addFoodMealId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          food_id: foodId,
          amount: 1,
        }),
      });
      if (entryRes.ok) {
        setAddFoodMealId(null);
        setAiResult(null);
        setAiFood("");
        setAiPortionValue("1");
        setAiPortionUnit("");
        setAiError(null);
        fetchDay();
      } else {
        const err = await entryRes.json().catch(() => ({}));
        alert((err.error as string) ?? "Failed to add to meal");
      }
    } finally {
      setAddingAiEntry(false);
    }
  }

  /** Unit type for the currently selected food (USDA, OFF, or favorite). */
  const addFoodUnitType = selectedUsdaFood != null
    ? getUnitType(selectedUsdaFood.servingSizeUnit)
    : selectedOffFood != null
      ? getUnitType(selectedOffFood.serving_size_unit)
      : selectedFavoriteId != null
        ? "serving"
        : null;
  /** Measurement options: for serving-type use slice/slices etc. when from USDA/OFF; otherwise fixed list. USDA-only: add tbsp/cup when we have portion data. */
  const addFoodMeasurementOptions = (() => {
    if (addFoodUnitType == null) return [];
    const base =
      addFoodUnitType === "serving" && (selectedUsdaFood?.servingSizeUnit ?? selectedOffFood?.serving_size_unit)
        ? getServingMeasurementOptions(selectedUsdaFood?.servingSizeUnit ?? selectedOffFood?.serving_size_unit ?? null)
        : MEASUREMENT_OPTIONS[addFoodUnitType];
    if (!selectedUsdaFood || !selectedUsdaPortions) return base;
    const extra: { value: string; label: string }[] = [];
    if (selectedUsdaPortions.tsp) extra.push({ value: "tsp", label: "teaspoon(s)" });
    if (selectedUsdaPortions.tbsp) extra.push({ value: "tbsp", label: "tablespoon(s)" });
    if (selectedUsdaPortions.cup) extra.push({ value: "cup", label: "cup(s)" });
    if (selectedUsdaPortions.flOz) extra.push({ value: "fl oz", label: "fl oz" });
    return [...base, ...extra];
  })();

  // Keep addMeasurement in sync with selected food's unit type
  useEffect(() => {
    if (addFoodMeasurementOptions.length === 0) return;
    const valid = addFoodMeasurementOptions.some((o) => o.value === addMeasurement);
    if (!valid) setAddMeasurement(addFoodMeasurementOptions[0].value);
  }, [addFoodUnitType, addFoodMeasurementOptions, addMeasurement]);

  async function handleSaveFavorite() {
    const name = saveFavName.trim();
    if (!name) return;
    setSavingFavorite(true);
    try {
      let body: { name: string; food_id?: number; amount?: number; meal_id?: number };
      if (saveFavFromEntry) {
        body = { name, food_id: saveFavFromEntry.food_id, amount: saveFavFromEntry.amount };
      } else if (saveFavFromMealId != null) {
        body = { name, meal_id: saveFavFromMealId };
      } else {
        setSavingFavorite(false);
        return;
      }
      const res = await fetch("/api/member/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveFavName("");
        setSaveFavFromEntry(null);
        setSaveFavFromMealId(null);
        setFavorites((prev) => [...prev, { id: data.id ?? 0, name, items: data.items ?? [] }]);
      }
    } finally {
      setSavingFavorite(false);
    }
  }

  async function handleUpdateEntryAmount(entryId: number) {
    const amount = parseFloat(editAmount);
    if (Number.isNaN(amount) || amount <= 0) return;
    const res = await fetch(`/api/member/journal/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      setEditEntryId(null);
      fetchDay();
    }
  }

  async function handleDeleteEntry(entryId: number) {
    if (!confirm("Remove this food from the meal?")) return;
    const res = await fetch(`/api/member/journal/entries/${entryId}`, { method: "DELETE" });
    if (res.ok) fetchDay();
  }

  async function handleEditMeal(mealId: number, newName: string) {
    const res = await fetch(`/api/member/journal/meals/${mealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() || "Meal" }),
    });
    if (res.ok) fetchDay();
  }

  async function handleDeleteMeal(mealId: number) {
    if (!confirm("Delete this meal and all its foods?")) return;
    const res = await fetch(`/api/member/journal/meals/${mealId}`, { method: "DELETE" });
    if (res.ok) fetchDay();
  }

  async function handleDeleteDay() {
    if (!confirm("Delete this entire day's journal? This cannot be undone.")) return;
    setDeletingDay(true);
    try {
      const res = await fetch(`/api/member/journal/days/${date}`, { method: "DELETE" });
      if (res.ok) router.push("/member/macros");
    } finally {
      setDeletingDay(false);
    }
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-stone-500">Invalid date.</p>
        <Link href="/member/macros" className="text-brand-600 underline text-sm mt-2 inline-block">← Macros</Link>
      </div>
    );
  }

  if (loading && !day) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const dateLabel = formatDateOnlyInAppTz(date, undefined, tz);
  const dayTotal = day ? sumMacros(day.meals.flatMap((m) => m.entries)) : { cal: 0, p: 0, f: 0, c: 0 };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Daily Food Journal</h1>
          <p className="text-stone-500 text-sm">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {day && day.meals.length > 0 && (
            <>
              {!showShare ? (
                <button
                  type="button"
                  onClick={() => { setShowShare(true); setShareResult(null); }}
                  className="text-brand-600 hover:underline text-sm font-medium"
                >
                  Share this day
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="Member's email"
                    className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm w-44"
                    onKeyDown={(e) => e.key === "Enter" && handleShareDay()}
                  />
                  <button
                    type="button"
                    onClick={handleShareDay}
                    disabled={sharing}
                    className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {sharing ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowShare(false); setShareEmail(""); setShareResult(null); }}
                    className="text-stone-500 hover:text-stone-700 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {shareResult && (
                <span className={`text-sm ${shareResult.ok ? "text-stone-600" : "text-red-600"}`}>
                  {shareResult.ok ? shareResult.message : shareResult.message}
                </span>
              )}
            </>
          )}
          <Link href="/member/macros" className="text-brand-600 hover:underline text-sm">← Macros</Link>
        </div>
      </div>

      {/* CTA: Book session with Exercise Physiologist */}
      <div className="mb-6 p-3 rounded-xl border border-brand-200 bg-brand-50 flex flex-wrap items-center justify-between gap-2">
        <p className="text-stone-700 text-sm">
          <span className="font-medium">Need help setting or hitting a gsoal?</span>{" "}
          <span className="text-stone-600">Book a session with our Exercise Physiologist.</span>
        </p>
        <Link href="/member/book-pt" className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Book a session →
        </Link>
      </div>

      {!day ? (
        <p className="text-stone-500">Creating your journal…</p>
      ) : (
        <>
          {/* Add Meal / Snack */}
          <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50 flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={addMealName}
              onChange={(e) => setAddMealName(e.target.value)}
              placeholder="e.g. Breakfast, Lunch, Snack"
              className="px-3 py-2 rounded-lg border border-stone-200 flex-1 min-w-[140px]"
            />
            <button
              type="button"
              onClick={handleAddMeal}
              disabled={addingMeal}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {addingMeal ? "Adding…" : "Add Meal / Snack"}
            </button>
          </div>

          {/* Today's progress: mauna (mountain) trackers — fill the mountain; over = red lava overflow */}
          {(goals.calories_goal != null && goals.calories_goal > 0) && (() => {
            const calGoal = goals.calories_goal ?? 0;
            const pPct = (goals.protein_pct ?? 0) / 100;
            const fPct = (goals.fat_pct ?? 0) / 100;
            const cPct = (goals.carbs_pct ?? 0) / 100;
            const goalP = calGoal > 0 ? (pPct * calGoal) / 4 : 0;
            const goalF = calGoal > 0 ? (fPct * calGoal) / 9 : 0;
            const goalC = calGoal > 0 ? (cPct * calGoal) / 4 : 0;
            return (
              <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-white">
                <p className="font-semibold text-stone-800 mb-4">Today&apos;s progress</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <MaunaTracker
                    label="Calories"
                    current={dayTotal.cal}
                    goal={calGoal}
                    unit="cal"
                    fillColor="bg-brand-500"
                  />
                  <MaunaTracker
                    label="Protein"
                    current={dayTotal.p}
                    goal={goalP}
                    unit="g"
                    fillColor="bg-blue-500"
                  />
                  <MaunaTracker
                    label="Fat"
                    current={dayTotal.f}
                    goal={goalF}
                    unit="g"
                    fillColor="bg-amber-500"
                  />
                  <MaunaTracker
                    label="Carbs"
                    current={dayTotal.c}
                    goal={goalC}
                    unit="g"
                    fillColor="bg-emerald-500"
                  />
                </div>
              </div>
            );
          })()}

          {/* Meals */}
          <div className="space-y-6 mb-8">
            {day.meals.map((meal) => {
              const mealMacros = sumMacros(meal.entries);
              return (
                <div key={meal.id} className="p-4 rounded-xl border border-stone-200 bg-white">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-semibold text-stone-800">{meal.name}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setSaveFavFromMealId(meal.id); setSaveFavFromEntry(null); setSaveFavName(meal.name); }}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Save to Favorites
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const n = prompt("Rename meal", meal.name);
                          if (n != null) handleEditMeal(meal.id, n);
                        }}
                        className="text-xs text-stone-500 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMeal(meal.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-1 text-sm text-stone-600">
                    {meal.entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2">
                        {editEntryId === e.id ? (
                          <span className="flex flex-col gap-1">
                            <span className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.25"
                                value={editAmount}
                                onChange={(ev) => setEditAmount(ev.target.value)}
                                className="w-20 px-2 py-1 border rounded"
                              />
                              <button type="button" onClick={() => handleUpdateEntryAmount(e.id)} className="text-brand-600 text-xs">Save</button>
                              <button type="button" onClick={() => setEditEntryId(null)} className="text-stone-400 text-xs">Cancel</button>
                            </span>
                            {e.amount === 1 && e.food?.serving_description?.trim() && (
                              <span className="text-xs text-stone-400">1 = full portion ({e.food.serving_description.trim()}). Use 2 only to add another same portion.</span>
                            )}
                          </span>
                        ) : (
                          <>
                            <span>{e.food?.name ?? "—"}{entryPortionLabel(e)}</span>
                            <span className="text-stone-400 text-xs">
                              {(() => {
                                const m = entryMacros(e);
                                return `${Math.round(m.cal)} cal · P ${m.p.toFixed(0)}g · F ${m.f.toFixed(0)}g · C ${m.c.toFixed(0)}g`;
                              })()}
                            </span>
                            <span className="flex gap-1">
                              <button type="button" onClick={() => { setEditEntryId(e.id); setEditAmount(String(e.amount)); }} className="text-stone-500 hover:underline text-xs">Edit</button>
                              <button type="button" onClick={() => handleDeleteEntry(e.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                              {e.food && (
                                <button
                                  type="button"
                                  onClick={() => { setSaveFavFromEntry({ food_id: e.food!.id, amount: e.amount }); setSaveFavName(e.food!.name); }}
                                  className="text-brand-600 hover:underline text-xs"
                                >
                                  Save to Favorites
                                </button>
                              )}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 pt-2 border-t border-stone-100 text-xs font-medium text-stone-500">
                    Meal total: {Math.round(mealMacros.cal)} cal · P {mealMacros.p.toFixed(0)}g · F {mealMacros.f.toFixed(0)}g · C {mealMacros.c.toFixed(0)}g
                  </div>
                  <button
                    type="button"
                    onClick={() => openAddFood(meal.id)}
                    className="mt-2 text-sm text-brand-600 hover:underline"
                  >
                    + Add Food / Drink
                  </button>
                </div>
              );
            })}
          </div>

          {/* Day total + How you did */}
          <div className="p-4 rounded-xl border-2 border-stone-200 bg-stone-50 mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="font-semibold text-stone-800">Day total</p>
              <p className="text-stone-600 text-sm">
                {Math.round(dayTotal.cal)} cal · Protein {dayTotal.p.toFixed(0)}g · Fat {dayTotal.f.toFixed(0)}g · Carbs {dayTotal.c.toFixed(0)}g
              </p>
            </div>
            {(goals.calories_goal != null && goals.calories_goal > 0) && (
              <div className="sm:text-right border-t sm:border-t-0 sm:border-l border-stone-200 pt-4 sm:pt-0 sm:pl-4">
                <p className="font-semibold text-stone-800 text-sm">How you did</p>
                <p className="text-stone-600 text-sm">
                  Calories: {Math.round(dayTotal.cal).toLocaleString()} / {goals.calories_goal.toLocaleString()}
                  {dayTotal.cal <= goals.calories_goal ? " ✓" : " (over)"}
                </p>
                {dayTotal.cal > 0 && (goals.protein_pct != null || goals.fat_pct != null || goals.carbs_pct != null) && (
                  <p className="text-stone-500 text-xs mt-1">
                    {[
                      goals.protein_pct != null && `P ${((dayTotal.p * 4) / dayTotal.cal * 100).toFixed(0)}% (goal ${goals.protein_pct}%)`,
                      goals.fat_pct != null && `F ${((dayTotal.f * 9) / dayTotal.cal * 100).toFixed(0)}% (goal ${goals.fat_pct}%)`,
                      goals.carbs_pct != null && `C ${((dayTotal.c * 4) / dayTotal.cal * 100).toFixed(0)}% (goal ${goals.carbs_pct}%)`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Delete day */}
          <div className="pt-4 border-t border-stone-200">
            <button
              type="button"
              onClick={handleDeleteDay}
              disabled={deletingDay}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              {deletingDay ? "Deleting…" : "Delete this day"}
            </button>
          </div>
        </>
      )}

      {/* Add Food modal */}
      {addFoodMealId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAddFoodMealId(null)}>
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-stone-200 flex justify-between items-center">
              <h2 className="font-semibold text-stone-800">Add Food / Drink</h2>
              <button type="button" onClick={() => setAddFoodMealId(null)} className="p-1 text-stone-500 hover:bg-stone-100 rounded">✕</button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Search USDA + Open Food Facts</label>
                <p className="text-xs text-stone-400 mb-1">Include the brand name (e.g. Nabisco Oreo) for more specific results.</p>
                <input
                  type="text"
                  value={foodSearch}
                  onChange={(e) => {
                    setFoodSearch(e.target.value);
                    setSelectedUsdaFood(null);
                    setSelectedUsdaPortions(null);
                    setSelectedOffFood(null);
                    setSelectedFavoriteId(null);
                  }}
                  placeholder="e.g. cereal, chicken breast, Nutella"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {searching && <p className="mt-1 text-sm text-stone-500">Searching both sources…</p>}
                {!searching && foodSearch.trim() && mergedSearchResults.length === 0 && (
                  <p className="mt-1 text-sm text-stone-500">No English results. Try another search.</p>
                )}
                {!searching && mergedSearchResults.length > 0 && (
                  <>
                    <p className="mt-1 text-xs text-stone-400">Most relevant first. English only. Quality checked.</p>
                    <ul className="mt-1 border border-stone-200 rounded-lg divide-y max-h-64 overflow-y-auto">
                      {mergedSearchResults.map((hit) => {
                        const key = hit.source === "usda" ? `usda-${hit.data.fdcId}` : `off-${hit.data.barcode}`;
                        if (hit.source === "usda") {
                          const f = hit.data;
                          const mPer100 = usdaMacros(f);
                          const quality = validateMacros({ calories: mPer100.cal ?? null, protein_g: mPer100.p ?? null, fat_g: mPer100.f ?? null, carbs_g: mPer100.c ?? null });
                          const servingGrams = f.servingSize != null && f.servingSizeUnit ? unitToGrams(f.servingSize, f.servingSizeUnit) : null;
                          const isVolumeServing = getUnitType(f.servingSizeUnit) === "volume";
                          const factor = servingGrams != null && servingGrams > 0 ? servingGrams / 100 : 1;
                          const canShowPerServing = !isVolumeServing || servingGrams != null;
                          const displayCal = canShowPerServing && mPer100.cal != null ? Math.round(mPer100.cal * factor) : null;
                          const displayP = canShowPerServing && mPer100.p != null ? Math.round(mPer100.p * factor * 10) / 10 : null;
                          const displayF = canShowPerServing && mPer100.f != null ? Math.round(mPer100.f * factor * 10) / 10 : null;
                          const displayC = canShowPerServing && mPer100.c != null ? Math.round(mPer100.c * factor * 10) / 10 : null;
                          // Label: show "100 g" when reference is 100g so numbers clearly match; otherwise show portion (e.g. 3.5 oz, 85 g)
                          const is100g = servingGrams != null && Math.abs(servingGrams - 100) < 0.5;
                          const servingDisplay =
                            f.servingSize != null && f.servingSizeUnit
                              ? is100g
                                ? "100 g"
                                : formatServingForDisplay(f.servingSize, f.servingSizeUnit)
                              : null;
                          const isSelected = selectedUsdaFood?.fdcId === f.fdcId;
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedUsdaFood(f);
                                  setSelectedOffFood(null);
                                  setSelectedFavoriteId(null);
                                  setSelectedUsdaPortions(null);
                                  fetch(`/api/foods/fetch-usda?fdcId=${f.fdcId}`)
                                    .then((r) => (r.ok ? r.json() : null))
                                    .then((full: { foodPortions?: USDAFoodPortion[] } | null) => {
                                      const fromApi = full?.foodPortions ? parseUsdaVolumePortions(full.foodPortions) : null;
                                      setSelectedUsdaPortions(fromApi ?? null);
                                    })
                                    .catch(() => {});
                                }}
                                className={`w-full text-left px-3 py-2.5 text-sm ${isSelected ? "bg-brand-100 text-brand-800" : "text-stone-700 hover:bg-stone-50"}`}
                              >
                                <span className="flex items-baseline gap-2 flex-wrap">
                                  <span className="shrink-0 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">USDA</span>
                                  <span className="font-medium text-stone-800 shrink-0">
                                  {servingDisplay ?? (f.servingSizeUnit && getUnitType(f.servingSizeUnit) === "serving" && f.servingSize === 1 ? "1 serving" : "1")}
                                </span>
                                  <span className="text-stone-600">{f.description ?? "Unknown"}</span>
                                  {quality.valid ? (
                                    <span className="ml-auto text-xs text-emerald-600 font-medium" title="Macros consistent">✓ OK</span>
                                  ) : quality.issues.length > 0 ? (
                                    <span className="ml-auto text-xs text-amber-600 font-medium" title={quality.issues.join("; ")}>Check</span>
                                  ) : null}
                                </span>
                                <span className="text-stone-500 text-xs block mt-0.5">
                                  {displayCal != null && <span>{displayCal} cal</span>}
                                  {displayP != null && <span> · P {displayP}g</span>}
                                  {displayF != null && <span> F {displayF}g</span>}
                                  {displayC != null && <span> C {displayC}g</span>}
                                  {displayCal == null && displayP == null && isVolumeServing && <span className="text-amber-600">per serving unknown (volume)</span>}
                                  {f.dataType && <span> · {f.dataType}</span>}
                                </span>
                              </button>
                            </li>
                          );
                        }
                        const f = hit.data;
                        const quality = validateMacros({ calories: f.calories, protein_g: f.protein_g, fat_g: f.fat_g, carbs_g: f.carbs_g, fiber_g: f.fiber_g });
                        const servingDisplayRaw = f.serving_size != null && f.serving_size_unit ? formatServingForDisplay(f.serving_size, f.serving_size_unit) : null;
                        const servingDisplay = servingDisplayRaw ?? (f.serving_size_unit && getUnitType(f.serving_size_unit) === "serving" && f.serving_size === 1 ? "1 serving" : "100 g");
                        const servingGrams = f.serving_size != null && f.serving_size_unit ? unitToGrams(f.serving_size, f.serving_size_unit) : null;
                        const isVolumeServingOff = getUnitType(f.serving_size_unit) === "volume";
                        // OFF normalizeOFFProduct already returns nutrients for the displayed serving (per-serving when not 100g). Show as-is.
                        const canShowPerServingOff = !isVolumeServingOff || servingGrams != null;
                        const displayCal = canShowPerServingOff && f.calories != null ? Math.round(f.calories) : null;
                        const displayP = canShowPerServingOff && f.protein_g != null ? Math.round(f.protein_g * 10) / 10 : null;
                        const displayF = canShowPerServingOff && f.fat_g != null ? Math.round(f.fat_g * 10) / 10 : null;
                        const displayC = canShowPerServingOff && f.carbs_g != null ? Math.round(f.carbs_g * 10) / 10 : null;
                        const isSelected = selectedOffFood?.barcode === f.barcode;
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              onClick={() => { setSelectedOffFood(f); setSelectedUsdaFood(null); setSelectedFavoriteId(null); }}
                              className={`w-full text-left px-3 py-2.5 text-sm ${isSelected ? "bg-brand-100 text-brand-800" : "text-stone-700 hover:bg-stone-50"}`}
                            >
                              <span className="flex items-baseline gap-2 flex-wrap">
                                <span className="shrink-0 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">OFF</span>
                                <span className="font-medium text-stone-800 shrink-0">{servingDisplay}</span>
                                <span className="text-stone-600">{f.name}</span>
                                {quality.valid ? (
                                  <span className="ml-auto text-xs text-emerald-600 font-medium" title="Macros consistent">✓ OK</span>
                                ) : quality.issues.length > 0 ? (
                                  <span className="ml-auto text-xs text-amber-600 font-medium" title={quality.issues.join("; ")}>Check</span>
                                ) : null}
                              </span>
                              <span className="text-stone-500 text-xs block mt-0.5">
                                {displayCal != null && <span>{displayCal} cal</span>}
                                {displayP != null && <span> · P {displayP}g</span>}
                                {displayF != null && <span> F {displayF}g</span>}
                                {displayC != null && <span> C {displayC}g</span>}
                                {displayCal == null && displayP == null && isVolumeServingOff && <span className="text-amber-600">per serving unknown (volume)</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Or pick from Favorites</label>
                {favorites.length === 0 ? (
                  <p className="text-stone-400 text-sm">No favorites yet. Save foods or meals from the journal.</p>
                ) : (
                  <ul className="border border-stone-200 rounded-lg divide-y max-h-40 overflow-y-auto">
                    {favorites.map((fav) => (
                      <li key={fav.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedFavoriteId(fav.id); setSelectedUsdaFood(null); setSelectedOffFood(null); }}
                          className={`w-full text-left px-3 py-2 text-sm ${selectedFavoriteId === fav.id ? "bg-brand-100 text-brand-800" : "text-stone-700 hover:bg-stone-50"}`}
                        >
                          {fav.name}
                          {fav.items?.length > 0 && <span className="text-stone-400 ml-1">({fav.items.length} items)</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Or calculate macros</label>
                <div className="flex flex-wrap gap-2 items-end">
                  <input
                    type="text"
                    value={aiFood}
                    onChange={(e) => { setAiFood(e.target.value); setAiError(null); }}
                    placeholder="e.g. honey, peanut butter"
                    className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                  />
                  <input
                    type="number"
                    step="0.25"
                    min="0.1"
                    value={aiPortionValue}
                    onChange={(e) => setAiPortionValue(e.target.value)}
                    className="w-16 px-2 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                  />
                  <select
                    value={aiPortionUnit}
                    onChange={(e) => setAiPortionUnit(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                  >
                    {AI_PORTION_UNITS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAiCalculate}
                    disabled={aiCalculating}
                    className="px-3 py-2 rounded-lg bg-stone-700 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
                  >
                    {aiCalculating ? "Calculating…" : "Calculate"}
                  </button>
                </div>
                {aiError && <p className="text-amber-600 text-sm mt-1">{aiError}</p>}
                {aiResult != null && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm">
                    <span className="text-stone-600">
                      {aiResult.calories} cal · P {aiResult.protein_g}g · F {aiResult.fat_g}g · C {aiResult.carbs_g}g
                    </span>
                    <button
                      type="button"
                      onClick={handleAddAiEntry}
                      disabled={addingAiEntry}
                      className="ml-2 px-2 py-1 rounded bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
                    >
                      {addingAiEntry ? "Adding…" : "Add to meal"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {(selectedUsdaFood != null || selectedOffFood != null || selectedFavoriteId != null) && (
              <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Quantity</label>
                  <input
                    type="number"
                    step={addFoodUnitType === "serving" ? "0.25" : "0.1"}
                    min="0.1"
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Measurement</label>
                  <select
                    value={addMeasurement}
                    onChange={(e) => setAddMeasurement(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white"
                  >
                    {addFoodMeasurementOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="p-4 border-t border-stone-200 flex gap-2">
              <button
                type="button"
                onClick={handleAddEntry}
                disabled={addingEntry || (selectedUsdaFood == null && selectedOffFood == null && selectedFavoriteId == null)}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {addingEntry ? "Adding…" : "Add"}
              </button>
              <button type="button" onClick={() => setAddFoodMealId(null)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save to Favorites modal */}
      {(saveFavFromEntry != null || saveFavFromMealId != null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setSaveFavFromEntry(null); setSaveFavFromMealId(null); }}>
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-stone-800 mb-2">Save to My Favorites</h2>
            <input
              type="text"
              value={saveFavName}
              onChange={(e) => setSaveFavName(e.target.value)}
              placeholder="e.g. Grandma's mashed potatoes"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 mb-4"
            />
            <div className="flex gap-2">
              <button type="button" onClick={handleSaveFavorite} disabled={savingFavorite || !saveFavName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
                {savingFavorite ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => { setSaveFavFromEntry(null); setSaveFavFromMealId(null); setSaveFavName(""); }} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
