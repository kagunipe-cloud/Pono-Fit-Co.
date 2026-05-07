"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import { getPresetRange } from "@/lib/report-date-presets";

type MemberRow = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type UnlockRow = {
  id: number;
  lock_id: number | null;
  lock_name: string | null;
  success: number;
  happened_at: string;
};

export default function MemberUnlocksReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tz = useAppTimezone();

  const initialMember = (searchParams.get("member_id") ?? "").trim();

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<MemberRow | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [unlocks, setUnlocks] = useState<UnlockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ from: string | null; to: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const r = getPresetRange("this-month");
    setFrom(r.from);
    setTo(r.to);
  }, []);

  useEffect(() => {
    if (!initialMember) return;
    fetch(`/api/members?q=${encodeURIComponent(initialMember)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: MemberRow[]) => {
        const exact = rows.find((m) => m.member_id === initialMember);
        if (exact) setSelected(exact);
        else if (rows.length === 1) setSelected(rows[0]!);
      })
      .catch(() => {});
  }, [initialMember]);

  const runSearch = useCallback(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    fetch(`/api/members?q=${encodeURIComponent(term)}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        return res.ok ? res.json() : [];
      })
      .then((rows: MemberRow[]) => setHits(Array.isArray(rows) ? rows : []))
      .catch(() => setHits([]))
      .finally(() => setSearching(false));
  }, [q, router]);

  useEffect(() => {
    const t = setTimeout(runSearch, 300);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  function applyPreset(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month") {
    const r = getPresetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }

  const loadUnlocks = useCallback(() => {
    if (!selected || !from || !to) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    fetch(`/api/members/${encodeURIComponent(selected.member_id)}/unlocks?${params}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        return res.json();
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setUnlocks([]);
          setMeta(null);
          return;
        }
        setUnlocks(json.unlocks ?? []);
        setMeta({ from: json.from ?? null, to: json.to ?? null });
      })
      .catch(() => {
        setError("Request failed.");
        setUnlocks([]);
      })
      .finally(() => setLoading(false));
  }, [selected, from, to, router]);

  useEffect(() => {
    if (selected && from && to) loadUnlocks();
  }, [selected, from, to, loadUnlocks]);

  const displayName = (m: MemberRow) =>
    [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.member_id;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link href="/reports" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Reports
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Member unlocks</h1>
      <p className="text-stone-600 text-sm mb-6">
        Choose a member and date range to list door unlocks from Kisi (same data as “Recent unlocks” on their profile).
      </p>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Find member</label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, or member ID"
            className="w-full max-w-md px-3 py-2 rounded-lg border border-stone-200 text-sm"
          />
          {searching && <p className="text-xs text-stone-500 mt-1">Searching…</p>}
          {hits.length > 0 && (
            <ul className="mt-2 border border-stone-200 rounded-lg divide-y divide-stone-100 max-w-md max-h-48 overflow-auto bg-stone-50">
              {hits.map((m) => (
                <li key={m.member_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(m);
                      setHits([]);
                      setQ("");
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white"
                  >
                    <span className="font-medium text-stone-800">{displayName(m)}</span>
                    <span className="text-stone-500 ml-2">{m.member_id}</span>
                    {m.email && <span className="block text-xs text-stone-400 truncate">{m.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <p className="text-sm">
            <span className="text-stone-500">Selected:</span>{" "}
            <strong>{displayName(selected)}</strong> ({selected.member_id})
            <button
              type="button"
              className="ml-3 text-brand-600 hover:underline text-sm"
              onClick={() => setSelected(null)}
            >
              Clear
            </button>
            <Link
              href={`/members/${selected.member_id}`}
              className="ml-3 text-brand-600 hover:underline text-sm"
            >
              Open profile
            </Link>
          </p>
        )}

        <div>
          <span className="block text-sm font-medium text-stone-700 mb-2">Date range</span>
          <div className="flex flex-wrap gap-2 mb-2">
            {(
              [
                ["today", "Today"],
                ["this-week", "This week"],
                ["this-month", "This month"],
                ["last-week", "Last week"],
                ["last-month", "Last month"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm hover:bg-stone-50"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 rounded border border-stone-200 text-sm"
            />
            <span className="text-stone-500">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 rounded border border-stone-200 text-sm"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {selected && meta && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 flex flex-wrap justify-between gap-2">
            <p className="text-sm text-stone-600">
              {loading ? "Loading…" : `${unlocks.length} unlock${unlocks.length === 1 ? "" : "s"}`}
              {meta.from && meta.to && (
                <span className="text-stone-500">
                  {" "}
                  ({meta.from} – {meta.to})
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={loadUnlocks}
              disabled={loading}
              className="text-sm text-brand-600 hover:underline disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {unlocks.length === 0 && !loading ? (
            <p className="p-6 text-stone-500 text-sm">No unlocks in this range.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-stone-50 text-stone-500">
                  <th className="py-2 px-4">Time</th>
                  <th className="py-2 px-4">Door</th>
                  <th className="py-2 px-4">Success</th>
                </tr>
              </thead>
              <tbody>
                {unlocks.map((u) => (
                  <tr key={u.id} className="border-t border-stone-100">
                    <td className="py-2 px-4 whitespace-nowrap">
                      {formatDateTimeInAppTz(new Date(u.happened_at), undefined, tz)}
                    </td>
                    <td className="py-2 px-4">{u.lock_name ?? u.lock_id ?? "—"}</td>
                    <td className="py-2 px-4">{u.success ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
