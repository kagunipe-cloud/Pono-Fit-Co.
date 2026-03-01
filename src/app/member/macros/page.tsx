"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateOnlyInAppTz, formatInAppTz, formatWeekdayShortInAppTz, todayInAppTz, weekStartInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";

type JournalDay = { id: number; member_id: string; date: string; created_at: string };
type MacroGoals = { calories_goal: number | null; protein_pct: number | null; fat_pct: number | null; carbs_pct: number | null; weight_goal: number | null };
type DaySummary = { cal: number; p: number; f: number; c: number };

function weekLabel(monday: string, tz: string): string {
  const d = new Date(monday + "T12:00:00Z");
  const sun = new Date(d);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const monStr = formatInAppTz(d, { month: "short", day: "numeric" }, tz);
  const sunStr = formatInAppTz(sun, { month: "short", day: "numeric", year: "numeric" }, tz);
  return `${monStr} – ${sunStr}`;
}

function daySlug(d: string, tz: string): string {
  return formatWeekdayShortInAppTz(d, tz);
}

export default function MemberMacrosPage() {
  const router = useRouter();
  const tz = useAppTimezone();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [daysByWeek, setDaysByWeek] = useState<Record<string, JournalDay[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  const [goals, setGoals] = useState<MacroGoals>({ calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null, weight_goal: null });
  const [goalsDraft, setGoalsDraft] = useState<MacroGoals>({ calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null, weight_goal: null });
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);
  const [weekSummary, setWeekSummary] = useState<Record<string, DaySummary> | null>(null);
  const [weighIns, setWeighIns] = useState<{ date: string; weight: number }[]>([]);
  const [weightChartRange, setWeightChartRange] = useState<"week" | "month" | "3m" | "6m" | "1y">("1y");

  const today = todayInAppTz(tz);
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
          const withWeight = { ...g, weight_goal: g.weight_goal ?? null };
          setGoals(withWeight);
          setGoalsDraft(withWeight);
        }
      })
      .catch(() => {});
  }, []);

  function saveGoals() {
    setSavingGoals(true);
    fetch("/api/member/macro-goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(goalsDraft),
    })
      .then((r) => {
        if (r.ok) {
          setGoals(goalsDraft);
          setGoalsEditing(false);
        }
      })
      .finally(() => setSavingGoals(false));
  }

  function clearGoals() {
    setSavingGoals(true);
    const cleared = { calories_goal: null, protein_pct: null, fat_pct: null, carbs_pct: null, weight_goal: null };
    fetch("/api/member/macro-goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleared),
    })
      .then((r) => {
        if (r.ok) {
          setGoals(cleared);
          setGoalsDraft(cleared);
          setGoalsEditing(false);
        }
      })
      .finally(() => setSavingGoals(false));
  }

  const hasAnyGoal = (goals.calories_goal != null && goals.calories_goal > 0) ||
    goals.protein_pct != null || goals.fat_pct != null || goals.carbs_pct != null ||
    (goals.weight_goal != null && goals.weight_goal > 0);

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

  const toDate = today;
  const fromDateByRange: Record<typeof weightChartRange, number> = { week: 7, month: 30, "3m": 90, "6m": 180, "1y": 365 };
  useEffect(() => {
    const days = fromDateByRange[weightChartRange];
    const from = new Date(toDate + "T12:00:00Z");
    from.setUTCDate(from.getUTCDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    fetch(`/api/member/weigh-ins?from=${fromStr}&to=${toDate}`)
      .then((r) => (r.ok ? r.json() : { weigh_ins: [] }))
      .then((data: { weigh_ins?: { date: string; weight: number }[] }) => setWeighIns(Array.isArray(data.weigh_ins) ? data.weigh_ins : []))
      .catch(() => setWeighIns([]));
  }, [weightChartRange, toDate]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const pctSum = (goalsDraft.protein_pct ?? 0) + (goalsDraft.fat_pct ?? 0) + (goalsDraft.carbs_pct ?? 0);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">My Macros</h1>
      <p className="text-stone-600 text-sm mb-6">Daily Food Journal — log meals and snacks, track macros by day and by week.</p>

      {/* CTA: Book session with Exercise Physiologist */}
      <div className="mb-6 p-4 rounded-xl border border-brand-200 bg-brand-50">
        <p className="text-stone-700 text-sm font-medium mb-2">Need help setting or hitting a goal?</p>
        <p className="text-stone-600 text-sm mb-3">Book a session with our Exercise Physiologist to get personalized macro and nutrition guidance.</p>
        <Link
          href="/member/book-pt"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          Book a session →
        </Link>
      </div>

      {/* Weight chart — data from daily weigh-ins in journal */}
      <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-white">
        <h2 className="font-semibold text-stone-800 mb-2">Weight</h2>
        <p className="text-xs text-stone-500 mb-3">From your daily weigh-ins in the journal. Toggle the range below.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(["week", "month", "3m", "6m", "1y"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setWeightChartRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${weightChartRange === r ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
            >
              {r === "3m" ? "3 months" : r === "6m" ? "6 months" : r === "1y" ? "1 year" : r === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
        {weighIns.length < 2 ? (
          <p className="text-sm text-stone-500">Log weight on at least two days in your journal to see the chart.</p>
        ) : (
          <div className="h-48 w-full">
            <svg viewBox="0 0 400 180" className="w-full h-full block" preserveAspectRatio="xMidYMid meet">
              {(() => {
                const pts = weighIns.map((w) => ({ x: w.date, y: w.weight }));
                const minY = Math.min(...pts.map((p) => p.y));
                const maxY = Math.max(...pts.map((p) => p.y));
                const range = maxY - minY || 1;
                const padding = 24;
                const w = 400;
                const h = 180;
                const xs = pts.map((_, i) => padding + (i / Math.max(1, pts.length - 1)) * (w - padding * 2));
                const ys = pts.map((p) => h - padding - ((p.y - minY) / range) * (h - padding * 2));
                const poly = pts.map((_, i) => `${xs[i]},${ys[i]}`).join(" ");
                return (
                  <>
                    <polyline points={poly} fill="none" stroke="var(--brand-600, #0d9488)" strokeWidth="2" />
                    {pts.map((p, i) => (
                      <circle key={p.x} cx={xs[i]} cy={ys[i]} r="3" fill="var(--brand-600)" />
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>
        )}
      </div>

      {/* Daily macro goals + weight goal — show after save unless Edit or Clear */}
      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-white">
        <h2 className="font-semibold text-stone-800 mb-3">Daily macro goals & weight goal</h2>
        {hasAnyGoal && !goalsEditing ? (
          <div>
            <p className="text-xs text-stone-500 mb-3">Shown until you click Edit or Clear.</p>
            <div className="flex flex-wrap gap-4 items-center text-sm">
              {goals.calories_goal != null && goals.calories_goal > 0 && (
                <span className="text-stone-700"><span className="font-medium text-stone-600">Calories:</span> {goals.calories_goal}</span>
              )}
              {goals.protein_pct != null && <span className="text-stone-700"><span className="font-medium text-stone-600">Protein:</span> {goals.protein_pct}%</span>}
              {goals.fat_pct != null && <span className="text-stone-700"><span className="font-medium text-stone-600">Fat:</span> {goals.fat_pct}%</span>}
              {goals.carbs_pct != null && <span className="text-stone-700"><span className="font-medium text-stone-600">Carbs:</span> {goals.carbs_pct}%</span>}
              {goals.weight_goal != null && goals.weight_goal > 0 && (
                <span className="text-stone-700"><span className="font-medium text-stone-600">Weight goal:</span> {goals.weight_goal} lbs</span>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setGoalsDraft(goals); setGoalsEditing(true); }} className="text-brand-600 hover:underline font-medium">
                  Edit
                </button>
                <button type="button" onClick={clearGoals} disabled={savingGoals} className="text-stone-500 hover:text-stone-700">
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-stone-500 mb-3">Set your daily calorie target, macro percentages, and optional weight goal. Used to chart progress.</p>
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
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Weight goal (lbs)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={goalsDraft.weight_goal ?? ""}
                  onChange={(e) => setGoalsDraft((g) => ({ ...g, weight_goal: e.target.value === "" ? null : parseFloat(e.target.value) || 0 }))}
                  placeholder="e.g. 150"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                />
              </div>
            </div>
            {pctSum > 0 && pctSum !== 100 && (
              <p className="text-xs text-amber-600 mt-2">P+F+C = {pctSum}%. Tip: set two and leave carbs blank to auto-fill (100 − P − F).</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={saveGoals}
                disabled={savingGoals}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {savingGoals ? "Saving…" : "Save goals"}
              </button>
              {goalsEditing && (
                <button type="button" onClick={() => { setGoalsDraft(goals); setGoalsEditing(false); }} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50">
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mb-8">
        <Link
          href={`/member/macros/day/${today}`}
          className="block p-4 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-300 hover:bg-brand-50 transition-colors"
        >
          <span className="font-semibold text-stone-800">Today&apos;s Journal</span>
          <span className="block text-sm text-stone-500 mt-0.5">
            {formatDateOnlyInAppTz(today, undefined, tz)}
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
                <span className="font-medium text-stone-800">{weekLabel(monday, tz)}</span>
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
                                {daySlug(date, tz)} {date} {daySet.has(date) ? "· logged" : ""}{calStr}{pctStr}
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

      <p className="mt-8">
        <Link href="/member" className="text-brand-600 hover:underline text-sm">← Back to member home</Link>
      </p>
    </div>
  );
}
