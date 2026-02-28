"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateInAppTz } from "@/lib/app-timezone";
import { getWeightComparisonWithArticle } from "@/lib/workout-congrats";
import { useAppTimezone } from "@/lib/settings-context";

type Workout = { id: number; member_id: string; started_at: string; finished_at: string | null; total_volume?: number; assigned_by_admin?: number; name?: string | null };

function getWorkoutDateInTz(w: Workout, tz: string): string {
  const raw = w.finished_at ?? w.started_at ?? "";
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return raw.slice(0, 10);
  }
}

export default function MemberWorkoutsPage() {
  const router = useRouter();
  const tz = useAppTimezone();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchWorkouts() {
    fetch("/api/member/workouts")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return [];
        }
        return res.json();
      })
      .then((data) => setWorkouts(Array.isArray(data) ? data : []))
      .catch(() => setWorkouts([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchWorkouts();
  }, [router]);

  async function handleStartWorkout() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/member/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to start workout");
        return;
      }
      if (data?.id) {
        router.push(`/member/workouts/${data.id}`);
        return;
      }
      fetchWorkouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setStarting(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const openWorkout = workouts.find((w) => !w.finished_at);
  const pastWorkouts = workouts.filter((w) => w.finished_at).sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));

  const now = new Date();
  const thisYear = now.toLocaleDateString("en-CA", { timeZone: tz }).slice(0, 4);
  const thisMonth = now.toLocaleDateString("en-CA", { timeZone: tz }).slice(0, 7);
  const volumeThisMonth = pastWorkouts
    .filter((w) => getWorkoutDateInTz(w, tz).startsWith(thisMonth))
    .reduce((sum, w) => sum + (w.total_volume ?? 0), 0);
  const volumeThisYear = pastWorkouts
    .filter((w) => getWorkoutDateInTz(w, tz).startsWith(thisYear))
    .reduce((sum, w) => sum + (w.total_volume ?? 0), 0);

  const byMonth = new Map<string, number>();
  const byYear = new Map<string, number>();
  for (const w of pastWorkouts) {
    const dateStr = getWorkoutDateInTz(w, tz);
    if (!dateStr) continue;
    const vol = w.total_volume ?? 0;
    const monthKey = dateStr.slice(0, 7);
    const yearKey = dateStr.slice(0, 4);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + vol);
    byYear.set(yearKey, (byYear.get(yearKey) ?? 0) + vol);
  }
  let monthlyRecord: { volume: number; monthKey: string } | null = null;
  let yearlyRecord: { volume: number; yearKey: string } | null = null;
  for (const [monthKey, volume] of byMonth) {
    if (volume > 0 && (!monthlyRecord || volume > monthlyRecord.volume)) {
      monthlyRecord = { volume, monthKey };
    }
  }
  for (const [yearKey, volume] of byYear) {
    if (volume > 0 && (!yearlyRecord || volume > yearlyRecord.volume)) {
      yearlyRecord = { volume, yearKey };
    }
  }
  const formatMonthKey = (key: string) => {
    try {
      return new Date(key + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } catch {
      return key;
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">My Workouts</h1>

      {error && (
        <p className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</p>
      )}
      <div className="mb-8">
        <button
          type="button"
          onClick={handleStartWorkout}
          disabled={starting || !!openWorkout}
          className="w-full sm:w-auto px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {starting ? "Starting…" : openWorkout ? "Workout in progress" : "Start Workout"}
        </button>
        {openWorkout && (
          <p className="mt-2 text-sm text-stone-500">
            <Link href={`/member/workouts/${openWorkout.id}`} className="text-brand-600 hover:underline">
              Open current workout →
            </Link>
          </p>
        )}
      </div>

      <p className="mb-6">
        <Link href="/member/workouts/progress" className="text-brand-600 hover:underline text-sm">View progress charts →</Link>
      </p>
      {(volumeThisMonth > 0 || volumeThisYear > 0 || monthlyRecord || yearlyRecord) && (
        <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h2 className="text-sm font-medium text-stone-500 mb-2">Total volume lifted</h2>
          <ul className="space-y-1 text-sm">
            {volumeThisMonth > 0 && (
              <li className="text-stone-700">
                <span className="font-medium text-brand-700">{Number(volumeThisMonth).toLocaleString()}</span> lbs this month
                {getWeightComparisonWithArticle(volumeThisMonth) && (
                  <span className="text-stone-500"> · {getWeightComparisonWithArticle(volumeThisMonth)}</span>
                )}
              </li>
            )}
            {volumeThisYear > 0 && (
              <li className="text-stone-700">
                <span className="font-medium text-brand-700">{Number(volumeThisYear).toLocaleString()}</span> lbs this year
                {getWeightComparisonWithArticle(volumeThisYear) && (
                  <span className="text-stone-500"> · {getWeightComparisonWithArticle(volumeThisYear)}</span>
                )}
              </li>
            )}
            {monthlyRecord && monthlyRecord.volume > 0 && (
              <li className="text-stone-700 pt-1 border-t border-stone-200 mt-1">
                <span className="font-medium text-stone-800">Monthly record:</span>{" "}
                <span className="font-medium text-brand-700">{Number(monthlyRecord.volume).toLocaleString()}</span> lbs
                <span className="text-stone-500"> ({formatMonthKey(monthlyRecord.monthKey)})</span>
                {getWeightComparisonWithArticle(monthlyRecord.volume) && (
                  <span className="text-stone-500"> · {getWeightComparisonWithArticle(monthlyRecord.volume)}</span>
                )}
              </li>
            )}
            {yearlyRecord && yearlyRecord.volume > 0 && (
              <li className="text-stone-700">
                <span className="font-medium text-stone-800">Yearly record:</span>{" "}
                <span className="font-medium text-brand-700">{Number(yearlyRecord.volume).toLocaleString()}</span> lbs
                <span className="text-stone-500"> ({yearlyRecord.yearKey})</span>
                {getWeightComparisonWithArticle(yearlyRecord.volume) && (
                  <span className="text-stone-500"> · {getWeightComparisonWithArticle(yearlyRecord.volume)}</span>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
      <h2 className="text-sm font-medium text-stone-500 mb-3">Past Workouts</h2>
      {pastWorkouts.length === 0 ? (
        <p className="text-stone-500">No past workouts yet. Start one above to track your lifts and cardio.</p>
      ) : (
        <ul className="space-y-2">
          {pastWorkouts.map((w) => (
            <li key={w.id}>
              <Link
                href={`/member/workouts/${w.id}`}
                className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-stone-800">{w.name?.trim() || "Workout"}</span>
                  {w.assigned_by_admin ? (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-800">From trainer</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-600">My workout</span>
                  )}
                </div>
                <span className="text-stone-500 ml-0 block mt-0.5 sm:ml-2 sm:inline sm:mt-0">{formatDateInAppTz(w.finished_at)}</span>
                {(w.total_volume ?? 0) > 0 && (
                  <>
                    <span className="ml-0 block sm:ml-2 text-sm font-medium text-brand-600 mt-0.5 sm:mt-0 sm:inline">
                      · {Number(w.total_volume).toLocaleString()} lbs total volume
                    </span>
                    {getWeightComparisonWithArticle(Number(w.total_volume)) && (
                      <span className="ml-0 block sm:ml-2 text-sm text-stone-500 mt-0.5 sm:mt-0 sm:inline">
                        · You lifted <span className="font-medium text-stone-700">{getWeightComparisonWithArticle(Number(w.total_volume))}</span>!
                      </span>
                    )}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8">
        <Link href="/member" className="text-brand-600 hover:underline text-sm">← Back to member home</Link>
      </p>
    </div>
  );
}
