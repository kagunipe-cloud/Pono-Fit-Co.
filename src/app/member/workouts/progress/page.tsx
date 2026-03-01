"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ChartExercise = { exercise_id: number; name: string; type: string };
type ChartPoint = { date: string; volume_lbs?: number; max_weight_lbs?: number; reps?: number; time_seconds?: number; distance_km?: number };

export default function MemberWorkoutProgressPage() {
  const router = useRouter();
  const [exercises, setExercises] = useState<ChartExercise[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ exercise: { id: number; name: string; type: string }; points: ChartPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChart, setLoadingChart] = useState(false);

  useEffect(() => {
    fetch("/api/member/workouts/chart-exercises")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return [];
        }
        return res.json();
      })
      .then((list: ChartExercise[]) => {
        setExercises(list);
        if (list.length > 0 && !selectedId) setSelectedId(list[0].exercise_id);
      })
      .catch(() => setExercises([]))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (selectedId == null) {
      setChartData(null);
      return;
    }
    setLoadingChart(true);
    fetch(`/api/member/workouts/chart?exercise_id=${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setChartData)
      .catch(() => setChartData(null))
      .finally(() => setLoadingChart(false));
  }, [selectedId]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Progress</h1>
        <Link href="/member/workouts" className="text-brand-600 hover:underline text-sm">← My Workouts</Link>
      </div>
      <p className="text-stone-600 text-sm mb-6">
        See how an exercise has improved over time. Only exercises you logged from the official list show up here.
      </p>

      {exercises.length === 0 ? (
        <div className="p-6 rounded-xl border border-stone-200 bg-stone-50">
          <p className="text-stone-600">
            No chartable exercises yet. When you add an exercise to a workout, pick one from the suggestions (e.g. &quot;Bench Press&quot;) so it can be tracked here.
          </p>
          <Link href="/member/workouts" className="mt-3 inline-block text-brand-600 hover:underline text-sm">Start a workout →</Link>
        </div>
      ) : (
        <>
          <label className="block text-sm font-medium text-stone-600 mb-2">Exercise</label>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="mb-6 w-full max-w-xs px-3 py-2 rounded-lg border border-stone-200"
          >
            {exercises.map((ex) => (
              <option key={ex.exercise_id} value={ex.exercise_id}>{ex.name} ({ex.type})</option>
            ))}
          </select>

          {loadingChart ? (
            <p className="text-stone-500">Loading…</p>
          ) : chartData && chartData.points.length > 0 ? (
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="p-3 bg-stone-50 border-b border-stone-200 font-medium text-stone-800">
                {chartData.exercise.name} over time
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50/50">
                      <th className="text-left p-3 font-medium text-stone-600">Date</th>
                      {chartData.exercise.type === "lift" && (
                        <>
                          <th className="text-right p-3 font-medium text-stone-600">Volume (lbs)</th>
                          <th className="text-right p-3 font-medium text-stone-600">Est. 1RM (lbs)</th>
                        </>
                      )}
                      {chartData.exercise.type === "cardio" && (
                        <>
                          <th className="text-right p-3 font-medium text-stone-600">Time</th>
                          <th className="text-right p-3 font-medium text-stone-600">Distance</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[...chartData.points].reverse().map((p, i) => (
                      <tr key={`${p.date}-${i}`} className="border-b border-stone-100">
                        <td className="p-3 text-stone-800">{p.date}</td>
                        {chartData.exercise.type === "lift" && (
                          <>
                            <td className="p-3 text-right text-stone-700">{p.volume_lbs != null ? p.volume_lbs.toLocaleString() : "—"}</td>
                            <td className="p-3 text-right text-stone-700">{p.max_weight_lbs != null ? p.max_weight_lbs : "—"}</td>
                          </>
                        )}
                        {chartData.exercise.type === "cardio" && (
                          <>
                            <td className="p-3 text-right text-stone-700">{p.time_seconds != null ? `${Math.round(p.time_seconds / 60)} min` : "—"}</td>
                            <td className="p-3 text-right text-stone-700">{p.distance_km != null ? `${p.distance_km} km` : "—"}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-stone-500">No data yet for this exercise. Log it in a finished workout to see progress.</p>
          )}
        </>
      )}

      <p className="mt-8">
        <Link href="/member" className="text-brand-600 hover:underline text-sm">← Back to member home</Link>
      </p>
    </div>
  );
}
