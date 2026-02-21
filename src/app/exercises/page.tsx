"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ExerciseRow = {
  id: number;
  name: string;
  type: string;
  primary_muscles?: string | null;
  secondary_muscles?: string | null;
  equipment?: string | null;
  muscle_group?: string | null;
  instructions?: string | null;
};

export default function ExercisesPage() {
  const [list, setList] = useState<ExerciseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<"lift" | "cardio">("lift");
  const [addMuscleGroup, setAddMuscleGroup] = useState("");
  const [addPrimaryMuscles, setAddPrimaryMuscles] = useState("");
  const [addEquipment, setAddEquipment] = useState("");
  const [addInstructions, setAddInstructions] = useState("");
  const [adding, setAdding] = useState(false);
  const [fetchingDb, setFetchingDb] = useState(false);
  const [freeDbResult, setFreeDbResult] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [fetchingWger, setFetchingWger] = useState(false);
  const [wgerResult, setWgerResult] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState<string | null>(null);
  const [fixingEncoding, setFixingEncoding] = useState(false);
  const [fixEncodingResult, setFixEncodingResult] = useState<string | null>(null);

  function fetchList() {
    fetch("/api/exercises")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ExerciseRow[]) => setList(Array.isArray(data) ? data : []))
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
      const instructionsText = addInstructions.trim();
      const instructions = instructionsText ? instructionsText.split("\n").map((s) => s.trim()).filter(Boolean) : undefined;
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: addType,
          muscle_group: addMuscleGroup.trim() || undefined,
          primary_muscles: addPrimaryMuscles.trim() || undefined,
          equipment: addEquipment.trim() || undefined,
          instructions,
        }),
      });
      if (res.ok) {
        setAddName("");
        setAddMuscleGroup("");
        setAddPrimaryMuscles("");
        setAddEquipment("");
        setAddInstructions("");
        fetchList();
      }
    } finally {
      setAdding(false);
    }
  }

  const FREE_EXERCISE_DB_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";

  async function handleImportFromFreeExerciseDb() {
    setFetchingDb(true);
    setFreeDbResult(null);
    try {
      const res = await fetch(FREE_EXERCISE_DB_URL);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) {
        setFreeDbResult("No exercises in response.");
        return;
      }
      const importRes = await fetch("/api/exercises/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(list),
      });
      const result = await importRes.json().catch(() => ({}));
      if (importRes.ok) {
        setFreeDbResult(`Added ${result.added ?? 0} of ${result.total ?? list.length} exercises from free-exercise-db.`);
        fetchList();
      } else {
        setFreeDbResult(result.error ?? "Import failed");
      }
    } catch (e) {
      setFreeDbResult(e instanceof Error ? e.message : "Failed to fetch or import");
    } finally {
      setFetchingDb(false);
    }
  }

  async function handleImportFromWger() {
    setFetchingWger(true);
    setWgerResult(null);
    try {
      const res = await fetch("/api/exercises/import-from-wger", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWgerResult(`Added ${data.added ?? 0} of ${data.total ?? 0} exercises from wger (e.g. Romanian deadlifts, more lifts).`);
        fetchList();
      } else {
        setWgerResult(data.error ?? "Import failed");
      }
    } catch (e) {
      setWgerResult(e instanceof Error ? e.message : "Import failed");
    } finally {
      setFetchingWger(false);
    }
  }

  async function handleImportCsv() {
    const text = csvText.trim();
    if (!text) {
      setCsvImportResult("Paste CSV with a header row first.");
      return;
    }
    setImportingCsv(true);
    setCsvImportResult(null);
    try {
      const res = await fetch("/api/exercises/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCsvImportResult(`Added ${data.added ?? 0} of ${data.total ?? 0} exercises from CSV.`);
        setCsvText("");
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

  async function handleBackfillMuscleGroups() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/exercises/backfill-muscle-groups", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBackfillResult(`Updated muscle_group for ${data.updated ?? 0} exercises.`);
        fetchList();
      } else {
        setBackfillResult(data.error ?? "Backfill failed");
      }
    } catch (e) {
      setBackfillResult(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Exercise database</h1>
      <p className="text-stone-600 text-sm mb-6">
        Official exercises members can pick when logging workouts. Picked exercises are available for progress charts.
      </p>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-4">
        <h2 className="font-semibold text-stone-800">Add one</h2>
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">Name</label>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="e.g. Bench Press"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium text-stone-600 mb-1">Type</label>
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value as "lift" | "cardio")}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            >
              <option value="lift">Lift</option>
              <option value="cardio">Cardio</option>
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium text-stone-600 mb-1">Muscle group</label>
            <input
              type="text"
              value={addMuscleGroup}
              onChange={(e) => setAddMuscleGroup(e.target.value)}
              placeholder="e.g. chest, legs"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium text-stone-600 mb-1">Target muscle</label>
            <input
              type="text"
              value={addPrimaryMuscles}
              onChange={(e) => setAddPrimaryMuscles(e.target.value)}
              placeholder="e.g. pectorals, triceps"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium text-stone-600 mb-1">Equipment</label>
            <input
              type="text"
              value={addEquipment}
              onChange={(e) => setAddEquipment(e.target.value)}
              placeholder="e.g. barbell, dumbbell"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">Instructions (one step per line)</label>
          <textarea
            value={addInstructions}
            onChange={(e) => setAddInstructions(e.target.value)}
            placeholder="Step 1&#10;Step 2&#10;..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
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

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Fix degree symbol (Â° → °)</h2>
        <p className="text-xs text-stone-500">
          Replace corrupted degree symbols (e.g. from import encoding) with the correct ° in all exercise names and instructions.
        </p>
        <button
          type="button"
          onClick={async () => {
            setFixingEncoding(true);
            setFixEncodingResult(null);
            try {
              const res = await fetch("/api/exercises/fix-degree-encoding", { method: "POST" });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                setFixEncodingResult(`Updated ${data.updated ?? 0} field(s).`);
                fetchList();
              } else {
                setFixEncodingResult(data.error ?? "Fix failed");
              }
            } catch (e) {
              setFixEncodingResult(e instanceof Error ? e.message : "Fix failed");
            } finally {
              setFixingEncoding(false);
            }
          }}
          disabled={fixingEncoding}
          className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 font-medium hover:bg-stone-100 disabled:opacity-50"
        >
          {fixingEncoding ? "Fixing…" : "Fix ° encoding"}
        </button>
        {fixEncodingResult && (
          <p className={`text-sm ${fixEncodingResult.startsWith("Updated") ? "text-stone-600" : "text-amber-700"}`}>{fixEncodingResult}</p>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Import from free-exercise-db (800+ exercises)</h2>
        <p className="text-xs text-stone-500">
          One-click import from the open <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">free-exercise-db</a> dataset. We map their fields to TYPE, NAME, MUSCLE GROUP, TARGET MUSCLE, EQUIPMENT. Their <a href="https://github.com/yuhonas/free-exercise-db#what-do-they-look-like" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">schema</a> (name, equipment, primaryMuscles, instructions, etc.) is documented in the repo. All imported as &quot;lift&quot;.
        </p>
        <button
          type="button"
          onClick={handleImportFromFreeExerciseDb}
          disabled={fetchingDb}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {fetchingDb ? "Fetching & importing…" : "Import from free-exercise-db"}
        </button>
        {freeDbResult && (
          <p className={`text-sm ${freeDbResult.startsWith("Added") ? "text-stone-600" : "text-amber-700"}`}>{freeDbResult}</p>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Import from wger (800+ exercises)</h2>
        <p className="text-xs text-stone-500">
          Another free source: <a href="https://wger.de" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">wger</a>. Includes many lifts missing from free-exercise-db (e.g. Romanian deadlift, more variants). No API key needed.
        </p>
        <button
          type="button"
          onClick={handleImportFromWger}
          disabled={fetchingWger}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {fetchingWger ? "Fetching & importing…" : "Import from wger"}
        </button>
        {wgerResult && (
          <p className={`text-sm ${wgerResult.startsWith("Added") ? "text-stone-600" : "text-amber-700"}`}>{wgerResult}</p>
        )}
      </div>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Import from CSV (e.g. Kaggle, cleaned in Google Sheets)</h2>
        <p className="text-xs text-stone-500">
          Paste CSV with a header row. Use these columns to match the table: <strong>TYPE</strong>, <strong>NAME</strong>, <strong>MUSCLE GROUP</strong>, <strong>TARGET MUSCLE</strong>, <strong>EQUIPMENT</strong>. (Synergist column optional.) Export from Google Sheets as CSV or copy and paste here.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"TYPE,NAME,MUSCLE GROUP,TARGET MUSCLE,EQUIPMENT\nlift,Bench Press,chest,pectorals; triceps,barbell"}
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

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Backfill muscle groups</h2>
        <p className="text-xs text-stone-500">
          Set the macro muscle group (legs, back, chest, shoulders, arms, core) for exercises that don’t have it yet. Safe to run more than once.
        </p>
        <button
          type="button"
          onClick={handleBackfillMuscleGroups}
          disabled={backfilling}
          className="px-4 py-2 rounded-lg border border-stone-200 font-medium hover:bg-stone-100 disabled:opacity-50"
        >
          {backfilling ? "Backfilling…" : "Backfill muscle groups"}
        </button>
        {backfillResult && (
          <p className={`text-sm ${backfillResult.startsWith("Updated") ? "text-stone-600" : "text-amber-700"}`}>{backfillResult}</p>
        )}
      </div>

      <h2 className="text-sm font-medium text-stone-500 mb-2">All exercises ({list.length})</h2>
      {list.length === 0 ? (
        <p className="text-stone-500">No exercises yet. Add or import above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border border-stone-200 rounded-lg overflow-hidden">
            <thead className="bg-stone-100 text-stone-600">
              <tr>
                <th className="px-3 py-2 font-medium">TYPE</th>
                <th className="px-3 py-2 font-medium">NAME</th>
                <th className="px-3 py-2 font-medium">MUSCLE GROUP</th>
                <th className="px-3 py-2 font-medium">TARGET MUSCLE</th>
                <th className="px-3 py-2 font-medium">EQUIPMENT</th>
                <th className="px-3 py-2 font-medium">INSTRUCTIONS</th>
                <th className="px-3 py-2 font-medium w-20"> </th>
              </tr>
            </thead>
            <tbody>
              {list.map((ex) => {
                let steps: string[] = [];
                if (ex.instructions?.trim()) {
                  try {
                    const parsed = JSON.parse(ex.instructions);
                    steps = Array.isArray(parsed) ? parsed.map(String) : [String(ex.instructions)];
                  } catch {
                    steps = [ex.instructions];
                  }
                }
                const preview = steps.length === 0 ? "—" : steps.length === 1
                  ? (steps[0].length > 100 ? steps[0].slice(0, 100) + "…" : steps[0])
                  : `${steps[0].length > 80 ? steps[0].slice(0, 80) + "…" : steps[0]} (+${steps.length - 1} more)`;
                return (
                  <tr key={ex.id} className="border-t border-stone-200 text-stone-700">
                    <td className="px-3 py-2 capitalize text-stone-500">{ex.type}</td>
                    <td className="px-3 py-2">{ex.name}</td>
                    <td className="px-3 py-2 capitalize text-stone-600">{ex.muscle_group || "—"}</td>
                    <td className="px-3 py-2 text-stone-600">
                      {ex.primary_muscles || ex.secondary_muscles
                        ? [ex.primary_muscles, ex.secondary_muscles].filter(Boolean).join(" / ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{ex.equipment || "—"}</td>
                    <td className="px-3 py-2 text-stone-600 max-w-[280px]" title={steps.length > 0 ? steps.join("\n\n") : undefined}>
                      <span className="line-clamp-2 text-xs">{preview}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/exercises/${ex.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8">
        <Link href="/" className="text-brand-600 hover:underline text-sm">← Home</Link>
      </p>
    </div>
  );
}
