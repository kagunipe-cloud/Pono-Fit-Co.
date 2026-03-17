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
} | null;

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "am" : "pm";
  return `${h}${ampm}`;
});

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetch(`/api/admin/occupancy-analytics?days=${days}`)
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (json?.dayHourByDay) setData(json);
        else setData(null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
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
              <div className="min-w-[700px] grid gap-px bg-stone-200 rounded-lg overflow-hidden" style={{ gridTemplateColumns: "4rem repeat(24, 1fr)" }}>
                <div className="p-2 bg-stone-100 text-xs font-medium text-stone-600" />
                {HOUR_LABELS.map((label, i) => (
                  <div key={i} className="p-1 bg-stone-100 text-[10px] font-medium text-stone-600 text-center">
                    {label}
                  </div>
                ))}
                {data.dayHourByDay.map((row) => (
                  <React.Fragment key={row.dayName}>
                    <div className="p-2 bg-stone-100 text-xs font-medium text-stone-700">
                      {row.dayName}
                    </div>
                    {row.hours.map((h) => (
                      <div
                        key={h.hour}
                        className="p-1.5 min-h-[2rem] flex items-center justify-center text-xs font-medium"
                        style={{ backgroundColor: getHeatmapColor(h.avgCount), color: h.avgCount > maxCount * 0.5 ? "white" : "inherit" }}
                        title={`${row.dayName} ${HOUR_LABELS[h.hour]}: avg ${h.avgCount}`}
                      >
                        {h.avgCount > 0 ? h.avgCount.toFixed(1) : "—"}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">Occupancy: Average Headcount Over Time (Daily)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailyLine} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, Math.ceil(maxCount * 1.1)]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v.toFixed(1), "Avg count"]} />
                  <Line type="monotone" dataKey="avgCount" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Avg" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">Occupancy: Average Headcount by Week</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weeklyLine} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, Math.ceil(maxCount * 1.1)]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v.toFixed(1), "Avg count"]} />
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
