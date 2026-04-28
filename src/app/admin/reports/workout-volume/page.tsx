"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getPresetRange } from "@/lib/report-date-presets";

type Row = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  total_volume: number;
  finished_workout_count: number;
};

export default function WorkoutVolumeReportPage() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [members, setMembers] = useState<Row[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const r = getPresetRange("this-month");
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const load = useCallback(() => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    fetch(`/api/admin/reports/workout-volume?${params}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        return res.json();
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setMembers([]);
          setGrandTotal(0);
          return;
        }
        setMembers(Array.isArray(json.members) ? json.members : []);
        setGrandTotal(typeof json.grand_total_volume === "number" ? json.grand_total_volume : 0);
        setTimezone(json.timezone ?? "");
      })
      .catch(() => {
        setError("Request failed.");
        setMembers([]);
        setGrandTotal(0);
      })
      .finally(() => setLoading(false));
  }, [from, to, router]);

  useEffect(() => {
    if (from && to) load();
  }, [from, to, load]);

  function applyPreset(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month") {
    const r = getPresetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }

  const name = (r: Row) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link href="/sales" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Reports
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Workout volume by member</h1>
      <p className="text-stone-600 text-sm mb-6">
        Lift volume per person: sum of <strong>reps × weight</strong> on finished workouts (same as the member app).
        Pick one day by setting <strong>From</strong> and <strong>To</strong> to that date, or choose a range.
        Workouts are counted by <strong>finish time</strong> in the gym timezone
        {timezone ? ` (${timezone})` : ""}. App Store / native-shell members are included when their workout is saved
        to the server like the website.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {(["today", "this-week", "this-month", "last-week", "last-month"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className="px-3 py-1.5 text-sm rounded-md bg-stone-100 text-stone-700 hover:bg-stone-200"
          >
            {p.replace(/-/g, " ")}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-stone-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-stone-300 rounded-md px-2 py-1.5 text-stone-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-stone-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-stone-300 rounded-md px-2 py-1.5 text-stone-800"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading || !from || !to}
          className="px-4 py-1.5 text-sm rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {!loading && members.length === 0 && !error && (
        <p className="text-stone-500 text-sm">No finished workouts in this range.</p>
      )}

      {members.length > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <div className="bg-stone-50 px-4 py-2 text-sm text-stone-700 flex flex-wrap justify-between gap-2">
            <span>
              <strong>{members.length}</strong> member{members.length === 1 ? "" : "s"} with at least one finished
              workout
            </span>
            <span>
              Combined volume: <strong>{grandTotal.toLocaleString()}</strong> lbs
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-100 text-left text-stone-700">
                <th className="p-3 font-medium">Member</th>
                <th className="p-3 font-medium text-right">Finished workouts</th>
                <th className="p-3 font-medium text-right">Volume (lbs)</th>
              </tr>
            </thead>
            <tbody>
              {members.map((r) => (
                <tr key={r.member_id} className="border-t border-stone-100">
                  <td className="p-3">
                    <Link
                      href={`/members/${encodeURIComponent(r.member_id)}`}
                      className="text-brand-700 hover:underline"
                    >
                      {name(r)}
                    </Link>
                  </td>
                  <td className="p-3 text-right text-stone-700">{r.finished_workout_count}</td>
                  <td className="p-3 text-right font-medium text-stone-800">{r.total_volume.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
