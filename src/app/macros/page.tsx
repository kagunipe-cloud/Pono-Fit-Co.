"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type FoodRow = {
  id: number;
  name: string;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  fiber_g: number | null;
  serving_description: string | null;
  source: string | null;
  created_at: string | null;
};

export default function MacrosPage() {
  const [list, setList] = useState<FoodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addCalories, setAddCalories] = useState("");
  const [addProtein, setAddProtein] = useState("");
  const [addFat, setAddFat] = useState("");
  const [addCarbs, setAddCarbs] = useState("");
  const [addFiber, setAddFiber] = useState("");
  const [addServing, setAddServing] = useState("");
  const [adding, setAdding] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [importingJson, setImportingJson] = useState(false);
  const [jsonImportResult, setJsonImportResult] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [usdaQuery, setUsdaQuery] = useState("");
  const [usdaSearching, setUsdaSearching] = useState(false);
  const [usdaResults, setUsdaResults] = useState<{ fdcId: number; description?: string; foodNutrients?: unknown[] }[]>([]);
  const [usdaError, setUsdaError] = useState<string | null>(null);
  const [savingFdcId, setSavingFdcId] = useState<number | null>(null);

  function fetchList() {
    fetch("/api/foods")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: FoodRow[]) => setList(Array.isArray(data) ? data : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchList();
  }, []);

  async function handleAdd() {
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/foods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          calories: addCalories.trim() ? parseFloat(addCalories) : null,
          protein_g: addProtein.trim() ? parseFloat(addProtein) : null,
          fat_g: addFat.trim() ? parseFloat(addFat) : null,
          carbs_g: addCarbs.trim() ? parseFloat(addCarbs) : null,
          fiber_g: addFiber.trim() ? parseFloat(addFiber) : null,
          serving_description: addServing.trim() || null,
          source: "manual",
        }),
      });
      if (res.ok) {
        setAddName("");
        setAddCalories("");
        setAddProtein("");
        setAddFat("");
        setAddCarbs("");
        setAddFiber("");
        setAddServing("");
        fetchList();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleImportCsv() {
    if (!csvText.trim()) return;
    setImportingCsv(true);
    setCsvImportResult(null);
    try {
      const res = await fetch("/api/foods/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCsvImportResult(`Added ${data.added ?? 0} of ${data.total ?? 0} foods.`);
        fetchList();
      } else {
        setCsvImportResult(data.error ?? "Import failed");
      }
    } catch (e) {
      setCsvImportResult(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportingCsv(false);
    }
  }

  async function handleImportJson() {
    if (!jsonText.trim()) return;
    setImportingJson(true);
    setJsonImportResult(null);
    try {
      const parsed = JSON.parse(jsonText.trim());
      const foods = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.foods) ? parsed.foods : [];
      const res = await fetch("/api/foods/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foods }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJsonImportResult(`Added ${data.added ?? 0} of ${data.total ?? 0} foods.`);
        fetchList();
      } else {
        setJsonImportResult(data.error ?? "Import failed");
      }
    } catch (e) {
      setJsonImportResult(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setImportingJson(false);
    }
  }

  async function handleUsdaSearch() {
    if (!usdaQuery.trim()) return;
    setUsdaSearching(true);
    setUsdaError(null);
    setUsdaResults([]);
    try {
      const res = await fetch(`/api/foods/search-usda?q=${encodeURIComponent(usdaQuery.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.foods)) {
        setUsdaResults(data.foods);
      } else {
        setUsdaError(data.error ?? "Search failed");
      }
    } catch (e) {
      setUsdaError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setUsdaSearching(false);
    }
  }

  async function handleSaveFromUsda(food: { fdcId: number; description?: string; foodNutrients?: unknown[] }) {
    setSavingFdcId(food.fdcId);
    try {
      let toSave = food;
      if (!Array.isArray(food.foodNutrients) || food.foodNutrients.length === 0) {
        const detailRes = await fetch(`/api/foods/fetch-usda?fdcId=${food.fdcId}`);
        if (!detailRes.ok) {
          setUsdaError("Could not load full food details");
          return;
        }
        toSave = await detailRes.json();
      }
      const res = await fetch("/api/foods/save-from-usda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      if (res.ok) {
        fetchList();
        setUsdaResults((prev) => prev.filter((f) => f.fdcId !== food.fdcId));
      } else {
        const data = await res.json().catch(() => ({}));
        setUsdaError(data.error ?? "Save failed");
      }
    } finally {
      setSavingFdcId(null);
    }
  }

  async function handleClearAll() {
    if (!confirm("Delete every food from the database? You can re-import afterward.")) return;
    setClearing(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/foods/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClearResult(`Cleared ${data.deleted ?? 0} foods.`);
        fetchList();
      } else {
        setClearResult(data.error ?? "Clear failed");
      }
    } catch (e) {
      setClearResult(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Macros</h1>
      <p className="text-stone-600 text-sm mb-6">
        Food database for calories, macros, and optional micronutrients. Add foods manually, search USDA and save (includes full macro + micro data), or import from CSV/JSON. Members can choose which nutrients to track via the member area.
      </p>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Add one food</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Name"
            className="px-3 py-2 rounded-lg border border-stone-200 sm:col-span-2"
          />
          <input
            type="text"
            value={addCalories}
            onChange={(e) => setAddCalories(e.target.value)}
            placeholder="Calories"
            className="px-3 py-2 rounded-lg border border-stone-200"
          />
          <input
            type="text"
            value={addProtein}
            onChange={(e) => setAddProtein(e.target.value)}
            placeholder="Protein (g)"
            className="px-3 py-2 rounded-lg border border-stone-200"
          />
          <input
            type="text"
            value={addFat}
            onChange={(e) => setAddFat(e.target.value)}
            placeholder="Fat (g)"
            className="px-3 py-2 rounded-lg border border-stone-200"
          />
          <input
            type="text"
            value={addCarbs}
            onChange={(e) => setAddCarbs(e.target.value)}
            placeholder="Carbs (g)"
            className="px-3 py-2 rounded-lg border border-stone-200"
          />
          <input
            type="text"
            value={addFiber}
            onChange={(e) => setAddFiber(e.target.value)}
            placeholder="Fiber (g)"
            className="px-3 py-2 rounded-lg border border-stone-200"
          />
          <input
            type="text"
            value={addServing}
            onChange={(e) => setAddServing(e.target.value)}
            placeholder="Serving (optional)"
            className="px-3 py-2 rounded-lg border border-stone-200 sm:col-span-2"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !addName.trim()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      <div className="mb-8 overflow-x-auto">
        <h2 className="text-sm font-medium text-stone-500 mb-2">Foods ({list.length})</h2>
        {loading ? (
          <p className="text-stone-500">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-stone-500">No foods yet. Add one above or import from CSV/JSON.</p>
        ) : (
          <table className="w-full border border-stone-200 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-stone-100 text-left text-sm font-medium text-stone-700">
                <th className="p-2 border-b border-stone-200">Name</th>
                <th className="p-2 border-b border-stone-200">Cal</th>
                <th className="p-2 border-b border-stone-200">P (g)</th>
                <th className="p-2 border-b border-stone-200">F (g)</th>
                <th className="p-2 border-b border-stone-200">C (g)</th>
                <th className="p-2 border-b border-stone-200">Fiber</th>
                <th className="p-2 border-b border-stone-200">Serving</th>
                <th className="p-2 border-b border-stone-200">Source</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="p-2 text-stone-800">{row.name}</td>
                  <td className="p-2 text-stone-600">{row.calories != null ? row.calories : "—"}</td>
                  <td className="p-2 text-stone-600">{row.protein_g != null ? row.protein_g : "—"}</td>
                  <td className="p-2 text-stone-600">{row.fat_g != null ? row.fat_g : "—"}</td>
                  <td className="p-2 text-stone-600">{row.carbs_g != null ? row.carbs_g : "—"}</td>
                  <td className="p-2 text-stone-600">{row.fiber_g != null ? row.fiber_g : "—"}</td>
                  <td className="p-2 text-stone-500 text-sm">{row.serving_description ?? "—"}</td>
                  <td className="p-2 text-stone-500 text-sm">{row.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Search USDA & save (macro + micronutrients)</h2>
        <p className="text-xs text-stone-500">
          Uses the <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">FoodData Central</a> API. Set <code className="bg-stone-200 px-1 rounded">FDC_API_KEY</code> in env for production (otherwise DEMO_KEY). Saved foods include all nutrients so members can track micros they choose.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={usdaQuery}
            onChange={(e) => setUsdaQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUsdaSearch()}
            placeholder="e.g. chicken breast, cheddar"
            className="px-3 py-2 rounded-lg border border-stone-200 flex-1 min-w-[180px]"
          />
          <button
            type="button"
            onClick={handleUsdaSearch}
            disabled={usdaSearching}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {usdaSearching ? "Searching…" : "Search USDA"}
          </button>
        </div>
        {usdaError && <p className="text-sm text-amber-700">{usdaError}</p>}
        {usdaResults.length > 0 && (
          <ul className="border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-60 overflow-y-auto">
            {usdaResults.map((f) => (
              <li key={f.fdcId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-stone-800 truncate">{f.description ?? `FDC ${f.fdcId}`}</span>
                <button
                  type="button"
                  onClick={() => handleSaveFromUsda(f)}
                  disabled={savingFdcId === f.fdcId}
                  className="shrink-0 px-2 py-1 rounded bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {savingFdcId === f.fdcId ? "Saving…" : "Save"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Import from USDA or other JSON</h2>
        <p className="text-xs text-stone-500">
          <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">USDA FoodData Central</a> provides JSON exports and an API. Once you have a JSON array of foods, paste it below. Each item should have at least <strong>name</strong> (or <strong>description</strong> / <strong>food_name</strong>). Optional: <strong>calories</strong>, <strong>protein_g</strong> / <strong>protein</strong>, <strong>fat_g</strong> / <strong>fat</strong>, <strong>carbs_g</strong> / <strong>carbs</strong>, <strong>fiber_g</strong> / <strong>fiber</strong>, <strong>serving_description</strong> / <strong>serving_size</strong>, <strong>source</strong>. We’ll add a dedicated USDA importer once you confirm the exact format.
        </p>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='[ { "name": "Chicken breast", "calories": 165, "protein_g": 31, "fat_g": 3.6, "carbs_g": 0 } ]'
          rows={5}
          className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
        />
        <button
          type="button"
          onClick={handleImportJson}
          disabled={importingJson || !jsonText.trim()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {importingJson ? "Importing…" : "Import from JSON"}
        </button>
        {jsonImportResult && (
          <p className={`text-sm ${jsonImportResult.startsWith("Added") ? "text-stone-600" : "text-amber-700"}`}>{jsonImportResult}</p>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Import from CSV</h2>
        <p className="text-xs text-stone-500">
          Paste CSV with a header row. Expected columns (case-insensitive): <strong>name</strong> (or description, food_name), <strong>calories</strong>, <strong>protein</strong> / protein_g, <strong>fat</strong>, <strong>carbs</strong> / carbohydrates, <strong>fiber</strong> (optional), <strong>serving_description</strong> / serving_size (optional), <strong>source</strong> (optional). Add more column mappings in the import API as you bring in new sources.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"name,calories,protein_g,fat_g,carbs_g,fiber_g\nChicken breast,165,31,3.6,0,0"}
          rows={5}
          className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
        />
        <button
          type="button"
          onClick={handleImportCsv}
          disabled={importingCsv || !csvText.trim()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {importingCsv ? "Importing…" : "Import from CSV"}
        </button>
        {csvImportResult && (
          <p className={`text-sm ${csvImportResult.startsWith("Added") ? "text-stone-600" : "text-amber-700"}`}>{csvImportResult}</p>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Clear all foods</h2>
        <p className="text-xs text-stone-500">
          Remove every food from the database. Use this to start fresh, then re-import from USDA, CSV, or JSON.
        </p>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={clearing}
          className="px-4 py-2 rounded-lg border border-amber-400 text-amber-800 font-medium hover:bg-amber-100 disabled:opacity-50"
        >
          {clearing ? "Clearing…" : "Clear all foods"}
        </button>
        {clearResult && (
          <p className={`text-sm ${clearResult.startsWith("Cleared") ? "text-stone-600" : "text-amber-700"}`}>{clearResult}</p>
        )}
      </div>
    </div>
  );
}
