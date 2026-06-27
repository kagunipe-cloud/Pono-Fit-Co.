"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import { getPresetRange } from "@/lib/report-date-presets";
import {
  FLOW_KIND_LABELS,
  MEMBERSHIP_FLOW_TABS,
  type MembershipFlowKind,
  type MembershipFlowTab,
} from "@/lib/membership-flow";
import type { MembershipFlowRow } from "@/app/api/admin/reports/membership-flow/route";

type Summary = Record<MembershipFlowKind, number>;

const EMPTY_SUMMARY: Summary = {
  new_member: 0,
  plan_change: 0,
  renewal: 0,
  auto_renew_on: 0,
  auto_renew_off: 0,
};

export default function MembershipFlowReportPage() {
  const router = useRouter();
  const tz = useAppTimezone();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<MembershipFlowTab>("all");
  const [events, setEvents] = useState<MembershipFlowRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
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
    const params = new URLSearchParams({ from, to, tab });
    fetch(`/api/admin/reports/membership-flow?${params}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        return res.json();
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setEvents([]);
          setSummary(EMPTY_SUMMARY);
          return;
        }
        setEvents(Array.isArray(json.events) ? json.events : []);
        setSummary({ ...EMPTY_SUMMARY, ...(json.summary ?? {}) });
      })
      .catch(() => {
        setError("Request failed.");
        setEvents([]);
        setSummary(EMPTY_SUMMARY);
      })
      .finally(() => setLoading(false));
  }, [from, to, tab, router]);

  useEffect(() => {
    if (from && to) load();
  }, [from, to, tab, load]);

  function applyPreset(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month") {
    const r = getPresetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }

  function flowKindClass(kind: MembershipFlowKind) {
    if (kind === "new_member") return "text-green-800 bg-green-50";
    if (kind === "plan_change") return "text-amber-800 bg-amber-50";
    if (kind === "renewal") return "text-blue-800 bg-blue-50";
    if (kind === "auto_renew_on") return "text-emerald-800 bg-emerald-50";
    return "text-red-800 bg-red-50";
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link href="/reports" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Reports
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Membership flow</h1>
      <p className="text-stone-600 text-sm mb-2">
        New members, returning members, renewals, and auto-renew toggles — brand-new members listed first, then plan
        changes and renewals.
      </p>
      <p className="text-stone-500 text-xs mb-6">
        Auto-renew history starts when that tracking was added; membership purchases use sales and subscription dates.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">
          <span className="block text-stone-600 mb-1">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-stone-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-stone-600 mb-1">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-stone-300 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {(["today", "this-week", "this-month", "last-week", "last-month"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-700 hover:bg-stone-50"
          >
            {preset.replace("-", " ")}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 border-b border-stone-200 pb-3">
        {MEMBERSHIP_FLOW_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-brand-600 text-white"
                : "border border-stone-300 text-stone-700 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!loading && !error && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
            <strong>{summary.new_member}</strong> new
          </span>
          <span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <strong>{summary.plan_change}</strong> returning / plan change
          </span>
          <span className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800">
            <strong>{summary.renewal}</strong> renewals
          </span>
          <span className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
            <strong>{summary.auto_renew_off}</strong> auto-renew off
          </span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
            <strong>{summary.auto_renew_on}</strong> auto-renew on
          </span>
        </div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="py-2 px-4 font-medium">When</th>
              <th className="py-2 px-4 font-medium">Member</th>
              <th className="py-2 px-4 font-medium">Flow</th>
              <th className="py-2 px-4 font-medium">Plan</th>
              <th className="py-2 px-4 font-medium">Membership type</th>
              <th className="py-2 px-4 font-medium">Auto-renew</th>
              <th className="py-2 px-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 px-4 text-center text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 px-4 text-center text-stone-500">
                  No membership flow events in this range{tab !== "all" ? " for this tab" : ""}.
                </td>
              </tr>
            ) : (
              events.map((row) => (
                <tr key={row.id} className="border-t border-stone-100">
                  <td className="py-2 px-4 whitespace-nowrap text-stone-700">
                    {formatDateTimeInAppTz(new Date(row.happened_at), undefined, tz)}
                  </td>
                  <td className="py-2 px-4">
                    <Link href={`/members/${row.member_id}`} className="font-medium text-brand-700 hover:underline">
                      {row.member_name}
                    </Link>
                    {row.email ? <div className="text-xs text-stone-500">{row.email}</div> : null}
                  </td>
                  <td className="py-2 px-4">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${flowKindClass(row.flow_kind)}`}
                    >
                      {FLOW_KIND_LABELS[row.flow_kind]}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-stone-700">{row.plan_name ?? "—"}</td>
                  <td className="py-2 px-4 text-stone-700">{row.membership_kind}</td>
                  <td className="py-2 px-4 text-stone-700">
                    {row.flow_kind === "auto_renew_on" || row.flow_kind === "auto_renew_off"
                      ? "—"
                      : row.auto_renew === 1
                        ? "Yes"
                        : "No"}
                  </td>
                  <td className="py-2 px-4 text-stone-600 text-xs">
                    {[row.detail, row.previous_plan_name && row.flow_kind === "plan_change" && !row.detail?.startsWith("Was:")
                      ? `Prev: ${row.previous_plan_name}`
                      : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
