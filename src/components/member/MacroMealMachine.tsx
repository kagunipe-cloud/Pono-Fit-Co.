"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MEAL_FRACTION_OPTIONS,
  computeMealPrefill,
  macroGramGoalsFromGoals,
  macroRemaining,
  recipeSearchUrl,
  type MealIdea,
  type MacroTotals,
} from "@/lib/macro-meal-machine";

type Goals = {
  calories_goal: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  carbs_pct: number | null;
};

type Props = {
  date: string;
  goals: Goals;
  consumed: { cal: number; p: number; f: number; c: number };
};

function toConsumed(c: Props["consumed"]): MacroTotals {
  return { calories: c.cal, protein_g: c.p, fat_g: c.f, carbs_g: c.c };
}

export default function MacroMealMachine({ date, goals, consumed }: Props) {
  const daily = macroGramGoalsFromGoals(
    goals.calories_goal,
    goals.protein_pct,
    goals.fat_pct,
    goals.carbs_pct
  );

  const [fraction, setFraction] = useState(0.25);
  const [ingredients, setIngredients] = useState("");
  const [mealTargets, setMealTargets] = useState<MacroTotals | null>(null);
  const [ideas, setIdeas] = useState<MealIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const consumedT = toConsumed(consumed);
  const remaining = useMemo(
    () => (daily ? macroRemaining(daily, consumedT) : null),
    [daily, consumedT]
  );

  const prefill = useMemo(() => {
    if (!daily) return null;
    return computeMealPrefill(daily, consumedT, fraction);
  }, [daily, consumedT, fraction]);

  useEffect(() => {
    if (prefill) setMealTargets(prefill);
  }, [prefill]);

  if (!daily || !remaining) {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
        <p className="text-sm font-semibold text-stone-800">Macro Meal Machine</p>
        <p className="mt-1 text-sm text-stone-600">
          Set daily calorie + macro % goals on{" "}
          <Link href="/member/macros" className="font-medium text-brand-700 hover:underline">
            My Macros
          </Link>{" "}
          to use this.
        </p>
      </div>
    );
  }

  const sliders = mealTargets ?? prefill!;

  async function runMachine() {
    setError(null);
    setIdeas(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/macro-meal-machine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date,
          ingredients,
          meal_targets: sliders,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
        return;
      }
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  function updateTarget(key: keyof MacroTotals, value: number) {
    setMealTargets((prev) => {
      const base = prev ?? prefill!;
      return { ...base, [key]: value };
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-brand-200 bg-gradient-to-br from-white to-brand-50/80 p-4 shadow-sm">
      <motionHeader />

      <p className="mt-2 text-xs text-stone-500 leading-relaxed">
        One meal, one shot: tell us what you can use, size it against today&apos;s plan, tweak targets if you want a
        protein-heavy dinner, then get a few ideas. No pantry tracking — ask fresh every time.
      </p>

      <label className="mt-4 block text-sm font-medium text-stone-700">
        What ingredients can we use?
        <textarea
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          rows={2}
          placeholder="e.g. chicken breast, rice, broccoli, eggs, salsa"
          className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </label>

      <label className="mt-3 block text-sm font-medium text-stone-700">
        How big is this meal?
        <select
          value={fraction}
          onChange={(e) => setFraction(parseFloat(e.target.value))}
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-brand-400 focus:outline-none"
        >
          {MEAL_FRACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-white/80 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">This meal&apos;s targets</p>
        <MacroSlider
          label="Calories"
          value={sliders.calories}
          max={Math.max(sliders.calories, Math.ceil(remaining.calories), 200)}
          unit="cal"
          onChange={(v) => updateTarget("calories", v)}
        />
        <MacroSlider
          label="Protein"
          value={sliders.protein_g}
          max={Math.max(sliders.protein_g, Math.ceil(remaining.protein_g), 20)}
          unit="g"
          onChange={(v) => updateTarget("protein_g", v)}
        />
        <MacroSlider
          label="Fat"
          value={sliders.fat_g}
          max={Math.max(sliders.fat_g, Math.ceil(remaining.fat_g), 15)}
          unit="g"
          onChange={(v) => updateTarget("fat_g", v)}
        />
        <MacroSlider
          label="Carbs"
          value={sliders.carbs_g}
          max={Math.max(sliders.carbs_g, Math.ceil(remaining.carbs_g), 30)}
          unit="g"
          onChange={(v) => updateTarget("carbs_g", v)}
        />
        <p className="text-[11px] text-stone-500">
          Left today: {Math.round(remaining.calories)} cal · {Math.round(remaining.protein_g)}g P ·{" "}
          {Math.round(remaining.fat_g)}g F · {Math.round(remaining.carbs_g)}g C
        </p>
      </div>

      <button
        type="button"
        disabled={loading || ingredients.trim().length < 2}
        onClick={() => void runMachine()}
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "Cranking the Machine…" : "Run Macro Meal Machine"}
      </button>

      {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

      {ideas && ideas.length > 0 && (
        <ul className="mt-4 space-y-3">
          {ideas.map((idea, i) => (
            <li key={`${idea.name}-${i}`} className="rounded-lg border border-stone-200 bg-white p-3">
              <p className="font-semibold text-stone-800">{idea.name}</p>
              <p className="mt-1 text-sm text-stone-600">{idea.summary}</p>
              <p className="mt-2 text-xs text-stone-500">
                ~{Math.round(idea.est_calories)} cal · {Math.round(idea.est_protein_g)}g P · {Math.round(idea.est_fat_g)}
                g F · {Math.round(idea.est_carbs_g)}g C
              </p>
              <a
                href={recipeSearchUrl(idea.recipe_search_query)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Find recipes ↗
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-stone-500">
        Estimates only — not medical or dietitian advice. Log what you actually eat in this journal.
      </p>
    </div>
  );
}

function motionHeader() {
  return (
    <div>
      <h2 className="text-lg font-bold text-stone-900 tracking-tight">Macro Meal Machine</h2>
      <p className="text-xs font-medium text-brand-700">Pono · one meal at a time</p>
    </div>
  );
}

function MacroSlider({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const displayMax = Math.max(max, value, 1);
  return (
    <div>
      <div className="flex justify-between text-xs text-stone-600 mb-1">
        <span>{label}</span>
        <span className="font-medium tabular-nums">
          {unit === "cal" ? Math.round(value) : Math.round(value)}
          {unit === "cal" ? " cal" : unit}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={displayMax}
        step={unit === "cal" ? 10 : 1}
        value={Math.min(value, displayMax)}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full accent-brand-600"
      />
    </div>
  );
}