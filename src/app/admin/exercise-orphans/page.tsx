"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  workout_exercise_id: number;
  workout_id: number;
  stale_exercise_id: number;
  exercise_name: string;
  exercise_type: string;
  member_id: string;
  member_name: string;
};

export default function ExerciseOrphansPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/workout-exercise-orphans")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login?next=/admin/exercise-orphans";
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.rows)) {
          setRows(data.rows);
          setCount(typeof data.count === "number" ? data.count : data.rows.length);
        } else {
          setRows([]);
          setCount(0);
        }
      })
      .catch(() => {
        setError("Failed to load");
        setRows([]);
        setCount(0);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function repair() {
    if (
      !window.confirm(
        "Set exercise_id to NULL on every workout line that points at a missing catalog exercise, and remove orphan My 1RM settings for missing exercises?\n\nExercise names on those workouts are kept."
      )
    ) {
      return;
    }
    setRepairing(true);
    setRepairMessage(null);
    try {
      const res = await fetch("/api/admin/workout-exercise-orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRepairMessage(typeof data.error === "string" ? data.error : "Repair failed");
        return;
      }
      setRepairMessage(
        `Unlinked ${data.workout_exercises_unlinked ?? 0} workout line(s); removed ${data.member_1rm_settings_removed ?? 0} orphan 1RM setting row(s).`
      );
      load();
    } catch {
      setRepairMessage("Request failed");
    } finally {
      setRepairing(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <p className="mb-4">
        <Link href="/exercises" className="text-brand-600 hover:underline text-sm font-medium">
          ← Exercise database
        </Link>
      </p>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Broken exercise links</h1>
      <p className="text-stone-600 text-sm mb-6">
        Workout lines that still store an <code className="text-xs bg-stone-100 px-1 rounded">exercise_id</code> for a
        row that no longer exists in the exercise catalog. Charts and “pick exercise” features need a valid id; the
        logged name is kept either way.
      </p>

      {repairMessage && (
        <p className="mb-4 text-sm text-stone-800 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{repairMessage}</p>
      )}

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : count === 0 ? (
        <p className="text-stone-600">None found — every workout line points at a real catalog exercise (or already has no id).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <p className="text-stone-700 font-medium">{count} line(s)</p>
            <button
              type="button"
              onClick={repair}
              disabled={repairing}
              className="px-3 py-1.5 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 disabled:opacity-50"
            >
              {repairing ? "Repairing…" : "Unlink broken IDs now"}
            </button>
          </div>
          <div className="rounded-xl border border-stone-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="p-2 font-medium">Member</th>
                  <th className="p-2 font-medium">Workout</th>
                  <th className="p-2 font-medium">Line</th>
                  <th className="p-2 font-medium">Stale id</th>
                  <th className="p-2 font-medium">Name (kept)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r) => (
                  <tr key={r.workout_exercise_id}>
                    <td className="p-2">
                      <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="text-brand-600 hover:underline">
                        {r.member_name}
                      </Link>
                    </td>
                    <td className="p-2 font-mono text-xs">#{r.workout_id}</td>
                    <td className="p-2 text-stone-500">we #{r.workout_exercise_id}</td>
                    <td className="p-2 font-mono text-xs">{r.stale_exercise_id}</td>
                    <td className="p-2">
                      {r.exercise_name}
                      <span className="text-stone-400 ml-1">({r.exercise_type})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
