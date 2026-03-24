"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

type AnalyticsData = {
  dayHourByDay: { dayName: string; hours: { hour: number; avgCount: number }[] }[];
  dailyLine: { date: string; avgCount: number }[];
  weeklyLine: { week: string; avgCount: number }[];
  timezone: string;
  days: number;
  open_hour_min: number;
  open_hour_max: number;
} | null;

type TodayCheckInsData = {
  date: string;
  timezone: string;
  totalToday: number;
  byHour: { hour: number; count: number }[];
  open_hour_min: number;
  open_hour_max: number;
} | null;

function getHourLabel(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  return `${h}${ampm}`;
}

/** Returns nice Y-axis domain and ticks for cleaner chart display. */
function getNiceYAxis(maxVal: number): { domain: [number, number]; ticks: number[] } {
  if (maxVal <= 0) return { domain: [0, 5], ticks: [0, 1, 2, 3, 4, 5] };
  const rawMax = Math.max(maxVal * 1.1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const normalized = rawMax / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const stepVal = step * magnitude;
  const niceMax = Math.ceil(rawMax / stepVal) * stepVal;
  const ticks: number[] = [];
  for (let i = 0; i * stepVal <= niceMax + 0.001; i++) {
    const t = Math.round(i * stepVal * 10) / 10;
    if (t <= niceMax) ticks.push(t);
  }
  return { domain: [0, niceMax], ticks };
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData>(null);
  const [todayCheckIns, setTodayCheckIns] = useState<TodayCheckInsData>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/occupancy-analytics?days=${days}`).then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      }),
      fetch("/api/admin/check-ins-today").then((r) => {
        if (r.status === 401) return null;
        return r.json();
      }),
    ])
      .then(([json, todayJson]) => {
        if (cancelled) return;
        if (json?.dayHourByDay) setData(json);
        else setData(null);
        if (todayJson?.byHour) setTodayCheckIns(todayJson);
        else setTodayCheckIns(null);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setTodayCheckIns(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, days]);

  if (loading) return <div className="p-8 text-stone-500">Loading…</div>;
  if (!data) return <div className="p-8 text-stone-500">Failed to load analytics.</div>;

  const heatmapData = data.dayHourByDay.flatMap((d) =>
    d.hours.map((h) => ({ avgCount: h.avgCount }))
  );
  const maxCount = Math.max(
    ...heatmapData.map((x) => x.avgCount),
    ...(data.dailyLine?.map((x) => x.avgCount) ?? []),
    ...(data.weeklyLine?.map((x) => x.avgCount) ?? []),
    1
  );
  const hasData = (data.dailyLine?.length ?? 0) > 0 || (data.weeklyLine?.length ?? 0) > 0;
  const yAxis = getNiceYAxis(maxCount);
  const openMin = data.open_hour_min ?? 6;
  const openMax = data.open_hour_max ?? 22;
  const hourRange = Array.from({ length: openMax - openMin + 1 }, (_, i) => openMin + i);
  const hourLabels = hourRange.map(getHourLabel);

  function getHeatmapColor(val: number): string {
    if (val <= 0) return "rgb(243 244 246)";
    const pct = Math.min(1, val / maxCount);
    const r = Math.round(34 + (110 - 34) * (1 - pct));
    const g = Math.round(197 + (255 - 197) * (1 - pct));
    const b = Math.round(94 + (255 - 94) * (1 - pct));
    return `rgb(${r}, ${g}, ${b})`;
  }

  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Analytics</h1>
        <p className="text-stone-500 mt-1">
          Occupancy and usage insights. Add more granular data over time.
          {data.timezone && ` Timezone: ${data.timezone}`}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-sm text-stone-600">Last</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </header>

      {todayCheckIns && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-1">Today: door check-ins by hour</h2>
          <p className="text-sm text-stone-500 mb-2">
            Total successful unlocks today ({todayCheckIns.date}) in {todayCheckIns.timezone}:{" "}
            <strong className="text-stone-800">{todayCheckIns.totalToday}</strong>. Resets at midnight (gym timezone).
            Each row in the Kisi webhook counts once; this is not the same as Coconut Count (see below).
          </p>
          <div className="overflow-x-auto mb-3">
            <div
              className="min-w-[480px] grid gap-px bg-stone-200 rounded-lg overflow-hidden"
              style={{ gridTemplateColumns: `4rem repeat(${todayCheckIns.byHour.length}, minmax(2rem, 1fr))` }}
            >
              <div className="p-2 bg-stone-100 text-xs font-medium text-stone-600">Today</div>
              {todayCheckIns.byHour.map(({ hour }) => (
                <div key={hour} className="p-1 bg-stone-100 text-[10px] font-medium text-stone-600 text-center">
                  {getHourLabel(hour)}
                </div>
              ))}
              <div className="p-2 bg-stone-100 text-xs font-medium text-stone-600">Count</div>
              {todayCheckIns.byHour.map(({ hour, count }) => {
                const maxH = Math.max(...todayCheckIns.byHour.map((x) => x.count), 1);
                const pct = Math.min(1, count / maxH);
                const r = Math.round(34 + (110 - 34) * (1 - pct));
                const g = Math.round(197 + (255 - 197) * (1 - pct));
                const b = Math.round(94 + (255 - 94) * (1 - pct));
                const bg = `rgb(${r}, ${g}, ${b})`;
                return (
                  <div
                    key={hour}
                    className="p-1.5 min-h-[2rem] flex items-center justify-center text-xs font-medium"
                    style={{ backgroundColor: bg, color: count > maxH * 0.5 ? "white" : "inherit" }}
                    title={`${getHourLabel(hour)}: ${count} check-in${count === 1 ? "" : "s"}`}
                  >
                    {count > 0 ? count : "—"}
                  </div>
                );
              })}
            </div>
          </div>
          <details className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 text-sm text-stone-600">
            <summary className="cursor-pointer font-medium text-stone-800">Coconut Count vs. this chart</summary>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>
                <strong>Coconut Count</strong> (dashboard widget) shows how many people are estimated on-site in the{" "}
                <em>last rolling hour</em> (entries expire after 1 hour). The same member tapping the door again within 60 minutes
                does not add another coconut — that avoids double-counting when someone re-enters quickly.
              </li>
              <li>
                <strong>This chart</strong> uses every successful door unlock from <code className="text-xs bg-stone-200 px-1 rounded">door_access_events</code> (Kisi webhook). Three taps → three cells in the hour totals (if the webhook is configured and deliveries succeed).
              </li>
              <li>
                If unlocks appear in Kisi but not here, verify the webhook URL{" "}
                <code className="text-xs bg-stone-200 px-1 rounded">/api/kisi/webhook</code> and{" "}
                <code className="text-xs bg-stone-200 px-1 rounded">KISI_WEBHOOK_SECRET</code> (signature must match).
              </li>
            </ul>
          </details>
        </section>
      )}

      {!hasData && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm mb-6">
          No occupancy data yet. Snapshots are recorded every 15 minutes. Check back after the system has been running for a while.
        </div>
      )}

      {hasData && (
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">Occupancy: Average by Day of Week × Hour</h2>
            <p className="text-sm text-stone-500 mb-4">
              Darker green = busier. Use this to see peak times for scheduling.
            </p>
            <div className="overflow-x-auto">
              <div className="min-w-[500px] grid gap-px bg-stone-200 rounded-lg overflow-hidden" style={{ gridTemplateColumns: `4rem repeat(${hourRange.length}, 1fr)` }}>
                <div className="p-2 bg-stone-100 text-xs font-medium text-stone-600" />
                {hourLabels.map((label, i) => (
                  <div key={i} className="p-1 bg-stone-100 text-[10px] font-medium text-stone-600 text-center">
                    {label}
                  </div>
                ))}
                {data.dayHourByDay.map((row) => (
                  <React.Fragment key={row.dayName}>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(selectedDay === row.dayName ? null : row.dayName)}
                      className={`p-2 bg-stone-100 text-xs font-medium text-left cursor-pointer hover:bg-stone-200 transition-colors rounded-l ${
                        selectedDay === row.dayName ? "ring-2 ring-emerald-500 ring-inset" : ""
                      } ${selectedDay === row.dayName ? "text-emerald-700 font-semibold" : "text-stone-700"}`}
                    >
                      {row.dayName}
                    </button>
                    {row.hours.map((h) => (
                      <button
                        type="button"
                        key={h.hour}
                        onClick={() => setSelectedDay(selectedDay === row.dayName ? null : row.dayName)}
                        className="p-1.5 min-h-[2rem] flex items-center justify-center text-xs font-medium cursor-pointer hover:ring-2 hover:ring-emerald-400 hover:ring-inset transition-all"
                        style={{ backgroundColor: getHeatmapColor(h.avgCount), color: h.avgCount > maxCount * 0.5 ? "white" : "inherit" }}
                        title={`${row.dayName} ${getHourLabel(h.hour)}: avg ${h.avgCount}`}
                      >
                        {h.avgCount > 0 ? h.avgCount.toFixed(1) : "—"}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <p className="text-xs text-stone-500 mt-2">Click a day to see hourly breakdown.</p>

            {selectedDay && (
              <div className="mt-6 p-4 rounded-lg border border-stone-200 bg-white">
                <h3 className="text-sm font-semibold text-stone-800 mb-3">
                  {selectedDay} — Average headcount by hour (last {days} days)
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.dayHourByDay
                        .find((d) => d.dayName === selectedDay)
                        ?.hours.map((h) => ({
                          hour: getHourLabel(h.hour),
                          avgCount: h.avgCount,
                        })) ?? []}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                      <YAxis domain={yAxis.domain} ticks={yAxis.ticks} tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip formatter={(v) => [typeof v === "number" ? v.toFixed(1) : String(v ?? ""), "Avg count"]} />
                      <Line type="monotone" dataKey="avgCount" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Avg" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">Occupancy: Daily Average Over Time</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailyLine} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={yAxis.domain} ticks={yAxis.ticks} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [typeof v === "number" ? v.toFixed(1) : String(v ?? ""), "Avg count"]} />
                  <Line type="monotone" dataKey="avgCount" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Avg" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">Occupancy: Daily Average by Week</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weeklyLine} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={yAxis.domain} ticks={yAxis.ticks} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [typeof v === "number" ? v.toFixed(1) : String(v ?? ""), "Avg count"]} />
                  <Bar dataKey="avgCount" fill="#22c55e" radius={[4, 4, 0, 0]} name="Avg" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
