"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateOnlyInAppTz, formatInAppTz, formatWeekdayShortInAppTz, todayInAppTz, weekStartInAppTz } from "@/lib/app-timezone";

type JournalDay = { id: number; member_id: string; date: string; created_at: string };
type MacroGoals = { calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null };
type DaySummary = { cal: number; p: number; f: number; c: number };

function weekLabel(monday: string): string {
  const d = new Date(monday + "T12:00:00Z");
  const sun = new Date(d);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const monStr = formatInAppTz(d, { month: "short", day: "numeric" });
  const sunStr = formatInAppTz(sun, { month: "short", day: "numeric", year: "numeric" });
  return `${monStr} – ${sunStr}`;
}

function daySlug(d: string): string {
  return formatWeekdayShortInAppTz(d);
}

export default function MemberMacrosPage() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [daysByWeek, setDaysByWeek] = useState<Record<string, JournalDay[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [goals, setGoals] = useState<MacroGoals>({ calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null });
  const [goalsDraft, setGoalsDraft] = useState<MacroGoals>({ calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null });
  const [savingGoals, setSavingGoals] = useState(false);
  const [weekSummary, setWeekSummary] = useState<Record<string, DaySummary> | null>(null);
  const [fixingDates, setFixingDates] = useState(false);
  const [fixDatesResult, setFixDatesResult] = useState<{ updated: number; merged: number } | null>(null);

  const today = todayInAppTz();
  const thisWeekMonday = weekStartInAppTz(today);
  const weekList = weeks.includes(thisWeekMonday) ? weeks : [thisWeekMonday, ...weeks];

  function fetchWeeks() {
    fetch("/api/member/journal/weeks")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return [];
        }
        return res.json();
      })
      .then((list: string[]) => setWeeks(Array.isArray(list) ? list : []))
      .catch(() => setWeeks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchWeeks();
  }, [router]);

  useEffect(() => {
    fetch("/api/member/macro-goals")
      .then((r) => (r.ok ? r.json() : null))
      .then((g: MacroGoals | null) => {
        if (g) {
          setGoals(g);
          setGoalsDraft(g);
        }
      })
      .catch(() => {});
  }, []);

  async function fixJournalDates() {
    setFixingDates(true);
    setFixDatesResult(null);
    try {
      const res = await fetch("/api/member/journal/fix-dates", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFixDatesResult({ updated: data.updated ?? 0, merged: data.merged ?? 0 });
      if (res.ok && ((data.updated ?? 0) + (data.merged ?? 0)) > 0) {
        fetchWeeks();
        if (selectedWeek) fetchDaysForWeek(selectedWeek);
      }
    } finally {
      setFixingDates(false);
    }
  }

  function saveGoals() {
    setSavingGoals(true);
    fetch("/api/member/macro-goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(goalsDraft),
    })
      .then((r) => {
        if (r.ok) setGoals(goalsDraft);
      })
      .finally(() => setSavingGoals(false));
  }

  function fetchDaysForWeek(weekStart: string) {
    fetch(`/api/member/journal/days?week=${weekStart}`)
      .then((res) => res.ok ? res.json() : [])
      .then((list: JournalDay[]) => {
        setDaysByWeek((prev) => ({ ...prev, [weekStart]: list }));
      })
      .catch(() => {});
    fetch(`/api/member/journal/days/summary?week=${weekStart}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((summary: Record<string, DaySummary>) => setWeekSummary(summary))
      .catch(() => setWeekSummary(null));
  }

  useEffect(() => {
    if (selectedWeek) {
      fetchDaysForWeek(selectedWeek);
    } else {
      setWeekSummary(null);
    }
  }, [selectedWeek]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const pctSum = (goalsDraft.protein_pct ?? 0) + (goalsDraft.fat_pct ?? 0) + (goalsDraft.carbs_pct ?? 0);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Macros</h1>
      <p className="text-stone-600 text-sm mb-6">Daily Food Journal — log meals and snacks, track macros by day and by week.</p>

      {/* CTA: Book session with Exercise Physiologist */}
      <div className="mb-6 p-4 rounded-xl border border-brand-200 bg-brand-50">
        <p className="text-stone-700 text-sm font-medium mb-2">Need help setting a goal?</p>
        <p className="text-stone-600 text-sm mb-3">Book a session with our Exercise Physiologist to get personalized macro and nutrition guidance.</p>
        <Link
          href="/member/book-pt"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          Book a session →
        </Link>
      </div>

      {/* Daily macro goals */}
      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-white">
        <h2 className="font-semibold text-stone-800 mb-3">Daily macro goals</h2>
        <p className="text-xs text-stone-500 mb-3">Set your daily calorie target and target percentages for protein, fat, and carbs. Used to chart progress on each day and in the weekly view.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Calories</label>
            <input
              type="number"
              min="0"
              step="50"
              value={goalsDraft.calories_goal ?? ""}
              onChange={(e) => setGoalsDraft((g) => ({ ...g, calories_goal: e.target.value === "" ? null : parseInt(e.target.value, 10) || 0 }))}
              placeholder="e.g. 2000"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Protein %</label>
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={goalsDraft.protein_pct ?? ""}
              onChange={(e) => setGoalsDraft((g) => ({ ...g, protein_pct: e.target.value === "" ? null : parseFloat(e.target.value) || 0 }))}
              placeholder="30"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Fat %</label>
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={goalsDraft.fat_pct ?? ""}
              onChange={(e) => setGoalsDraft((g) => ({ ...g, fat_pct: e.target.value === "" ? null : parseFloat(e.target.value) || 0 }))}
              placeholder="30"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Carbs %</label>
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={goalsDraft.carbs_pct ?? ""}
              onChange={(e) => setGoalsDraft((g) => ({ ...g, carbs_pct: e.target.value === "" ? null : parseFloat(e.target.value) || 0 }))}
              placeholder="40"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
            />
          </div>
        </div>
        {pctSum > 0 && pctSum !== 100 && (
          <p className="text-xs text-amber-600 mt-2">P+F+C = {pctSum}%. Tip: set two and leave carbs blank to auto-fill (100 − P − F).</p>
        )}
        <button
          type="button"
          onClick={saveGoals}
          disabled={savingGoals}
          className="mt-3 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {savingGoals ? "Saving…" : "Save goals"}
        </button>
      </div>

      <div className="mb-8">
        <Link
          href={`/member/macros/day/${today}`}
          className="block p-4 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-300 hover:bg-brand-50 transition-colors"
        >
          <span className="font-semibold text-stone-800">Today&apos;s Journal</span>
          <span className="block text-sm text-stone-500 mt-0.5">
            {formatDateOnlyInAppTz(today)}
          </span>
          <span className="text-brand-600 text-sm font-medium mt-1 inline-block">Open journal →</span>
        </Link>
      </div>

      <h2 className="text-sm font-medium text-stone-500 mb-3">Weeks</h2>
      {weekList.length === 0 ? (
        <p className="text-stone-500">Open today&apos;s journal and add a meal to get started.</p>
      ) : (
        <ul className="space-y-4">
          {weekList.map((monday) => (
            <li key={monday}>
              <button
                type="button"
                onClick={() => setSelectedWeek(selectedWeek === monday ? null : monday)}
                className="w-full text-left p-4 rounded-xl border border-stone-200 bg-white hover:bg-stone-50"
              >
                <span className="font-medium text-stone-800">{weekLabel(monday)}</span>
                {monday === thisWeekMonday && (
                  <span className="ml-2 text-xs font-medium text-brand-600">This week</span>
                )}
              </button>
              {selectedWeek === monday && (
                <>
                  {weekSummary && (() => {
                    const weekDays = [];
                    for (let i = 0; i < 7; i++) {
                      const d = new Date(monday + "T12:00:00Z");
                      d.setUTCDate(d.getUTCDate() + i);
                      weekDays.push(d.toISOString().slice(0, 10));
                    }
                    const totals = weekDays.reduce((acc, d) => {
                      const s = weekSummary[d];
                      if (s) {
                        acc.cal += s.cal;
                        acc.p += s.p;
                        acc.f += s.f;
                        acc.c += s.c;
                        acc.days++;
                      }
                      return acc;
                    }, { cal: 0, p: 0, f: 0, c: 0, days: 0 });
                    const avgCal = totals.days > 0 ? Math.round(totals.cal / totals.days) : 0;
                    const goalCal = goals.calories_goal ?? 0;
                    return (
                      <div className="mt-2 mb-2 px-4 py-2 rounded-lg bg-stone-100 text-sm text-stone-600">
                        <span className="font-medium text-stone-700">Week summary</span>
                        {" "}· {totals.days} day{totals.days !== 1 ? "s" : ""} logged
                        {totals.cal > 0 && (
                          <> · Total {Math.round(totals.cal).toLocaleString()} cal</>
                        )}
                        {goalCal > 0 && totals.days > 0 && (
                          <> · Avg {avgCal.toLocaleString()} cal/day (goal {goalCal.toLocaleString()})</>
                        )}
                      </div>
                    );
                  })()}
                  <ul className="mt-2 ml-2 pl-4 border-l-2 border-stone-200 space-y-1">
                    {daysByWeek[monday] === undefined ? (
                      <li className="text-stone-400 text-sm py-1">Loading…</li>
                    ) : (
                      (() => {
                        const days = daysByWeek[monday] ?? [];
                        const daySet = new Set(days.map((d) => d.date));
                        const weekDays = [];
                        for (let i = 0; i < 7; i++) {
                          const d = new Date(monday + "T12:00:00Z");
                          d.setUTCDate(d.getUTCDate() + i);
                          weekDays.push(d.toISOString().slice(0, 10));
                        }
                        return weekDays.map((date) => {
                          const s = weekSummary?.[date];
                          const calStr = s && s.cal > 0 ? ` · ${Math.round(s.cal).toLocaleString()} cal` : "";
                          const pctStr = s && s.cal > 0 && (s.p + s.f + s.c) > 0
                            ? ` · ${Math.round((s.p * 4 / s.cal) * 100)}% P`
                            : "";
                          return (
                            <li key={date}>
                              <Link
                                href={`/member/macros/day/${date}`}
                                className="block py-1.5 text-sm text-stone-700 hover:text-brand-600"
                              >
                                {daySlug(date)} {date} {daySet.has(date) ? "· logged" : ""}{calStr}{pctStr}
                              </Link>
                            </li>
                          );
                        });
                      })()
                    )}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* One-time fix: reassign journal days to Hawaiian date when they were created */}
      <div className="mt-8 p-4 rounded-xl border border-stone-200 bg-stone-50">
        <p className="text-stone-600 text-sm mb-2">If you logged food when &quot;today&quot; was still using the wrong timezone, you can move those days to the correct date (Hawaiian time).</p>
        <button
          type="button"
          onClick={fixJournalDates}
          disabled={fixingDates}
          className="text-brand-600 hover:underline text-sm font-medium disabled:opacity-50"
        >
          {fixingDates ? "Fixing…" : "Fix past journal dates"}
        </button>
        {fixDatesResult && (
          <p className="text-stone-500 text-xs mt-2">
            {fixDatesResult.updated + fixDatesResult.merged === 0
              ? "No changes needed."
              : `Updated ${fixDatesResult.updated} day(s), merged ${fixDatesResult.merged} into existing days.`}
          </p>
        )}
      </div>

      <p className="mt-8">
        <Link href="/member" className="text-brand-600 hover:underline text-sm">← Back to member home</Link>
      </p>
    </div>
  );
}
