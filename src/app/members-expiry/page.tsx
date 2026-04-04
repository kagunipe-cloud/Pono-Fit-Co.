"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateForDisplay } from "@/lib/app-timezone";
import type { MembersExpiryRange, MembersExpiryRow } from "@/app/api/admin/members-expiry-report/route";

const PRESETS: { range: MembersExpiryRange; label: string; hint: string }[] = [
  { range: "expiring_today", label: "Expiring today", hint: "Active subs ending today" },
  { range: "expiring_tomorrow", label: "Expiring tomorrow", hint: "Active subs ending tomorrow" },
  { range: "expiring_rest_of_week", label: "Rest of this week", hint: "After tomorrow through Sunday (same calendar week)" },
  { range: "expired_yesterday", label: "Expired yesterday", hint: "Ended yesterday" },
  { range: "expired_last_two_days", label: "Last 2 days", hint: "Ended yesterday or two days ago" },
  { range: "expired_last_week", label: "3–7 days ago", hint: "Ended 3–7 days ago (outreach)" },
];

function currentMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function MembersExpiryPage() {
  const router = useRouter();
  const [range, setRange] = useState<MembersExpiryRange>("expiring_today");
  const [month, setMonth] = useState(currentMonthYmd);
  const [rows, setRows] = useState<MembersExpiryRow[]>([]);
  const [meta, setMeta] = useState<{ todayYmd: string; timezone: string; expiryWindow: { start: string; end: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      if (range === "calendar_month") params.set("month", month);
      const res = await fetch(`/api/admin/members-expiry-report?${params}`);
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMeta({
        todayYmd: data.todayYmd ?? "",
        timezone: data.timezone ?? "",
        expiryWindow: data.expiryWindow ?? { start: "", end: "" },
      });
    } catch {
      setError("Failed to load report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [range, month, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const groupedByExpiry = useMemo(() => {
    if (range !== "calendar_month") return null;
    const map = new Map<string, MembersExpiryRow[]>();
    for (const r of rows) {
      const k = (r.expiry_date ?? "").trim() || "—";
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, range]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Membership expiry</h1>
      <p className="text-stone-500 mb-4">
        Monthly memberships (pass packs excluded). Use this for outreach — e.g. someone who isn&apos;t on auto-renew but might want to continue.
        {meta?.timezone ? (
          <span className="block text-sm mt-1 text-stone-400">
            Today in app: <strong className="text-stone-600">{meta.todayYmd}</strong> ({meta.timezone})
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.range}
            type="button"
            title={p.hint}
            onClick={() => setRange(p.range)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              range === p.range ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRange("calendar_month")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            range === "calendar_month" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          Calendar month
        </button>
      </div>

      {range === "calendar_month" && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <label className="text-sm font-medium text-stone-600">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="ml-2 px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900"
            />
          </label>
          <span className="text-sm text-stone-500">Shows all subs with expiry in that month (active + cancelled).</span>
        </div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">
          No subscriptions in this window.
        </div>
      ) : range === "calendar_month" && groupedByExpiry ? (
        <div className="space-y-6">
          {groupedByExpiry.map(([day, list]) => (
            <div key={day} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
              <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 text-sm font-semibold text-stone-700">
                {day === "—" ? "—" : formatDateForDisplay(day)} <span className="font-normal text-stone-500">({list.length})</span>
              </div>
              <ExpiryTable rows={list} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <ExpiryTable rows={rows} />
        </div>
      )}

      <p className="mt-6 text-sm text-stone-500">
        <Link href="/subscriptions" className="text-brand-600 hover:underline">
          Subscriptions table
        </Link>
        {" · "}
        <Link href="/money-owed" className="text-brand-600 hover:underline">
          Money owed
        </Link>
        {" · "}
        <Link href="/members" className="text-brand-600 hover:underline">
          Members
        </Link>
      </p>
    </div>
  );
}

function ExpiryTable({ rows }: { rows: MembersExpiryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[720px]">
        <thead>
          <tr className="bg-stone-50 text-stone-500">
            <th className="py-2 px-4">Member</th>
            <th className="py-2 px-4">Plan</th>
            <th className="py-2 px-4">Expiry</th>
            <th className="py-2 px-4">Status</th>
            <th className="py-2 px-4">Auto-renew</th>
            <th className="py-2 px-4">Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.member_id}-${r.subscription_id ?? ""}-${r.expiry_date}`} className="border-t border-stone-100">
              <td className="py-2 px-4">
                <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="text-brand-600 hover:underline font-medium">
                  {r.member_name}
                </Link>
                {r.email && <span className="block text-xs text-stone-500">{r.email}</span>}
              </td>
              <td className="py-2 px-4">{r.plan_name ?? "—"}</td>
              <td className="py-2 px-4">{r.expiry_date ? formatDateForDisplay(r.expiry_date) : "—"}</td>
              <td className="py-2 px-4">
                {r.status === "Active" ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-800">Active</span>
                ) : r.status === "Cancelled" ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-stone-200 text-stone-700">Cancelled</span>
                ) : (
                  r.status ?? "—"
                )}
              </td>
              <td className="py-2 px-4">{r.auto_renew === 1 ? "Yes" : "No"}</td>
              <td className="py-2 px-4">{r.price ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
