"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import { getPresetRange } from "@/lib/report-date-presets";
import {
  formatInsuranceProgramLabel,
  INSURANCE_PROGRAM_LABELS,
  type InsuranceProgramValue,
} from "@/lib/insurance-program";

type ReportProgramFilter = "all" | InsuranceProgramValue;

type Row = {
  id: number;
  lock_name: string | null;
  lock_id: number | null;
  success: number;
  happened_at: string;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  insurance_program: string | null;
};

type MemberSummary = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  insurance_program: string | null;
  billable_days: number;
  all_unlocks: Row[];
};

export default function InsuranceReportPage() {
  const router = useRouter();
  const tz = useAppTimezone();

  const [program, setProgram] = useState<ReportProgramFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [totalBillableDays, setTotalBillableDays] = useState(0);
  const [timezone, setTimezone] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  useEffect(() => {
    const r = getPresetRange("this-month");
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const load = useCallback(() => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ program, from, to });
    fetch(`/api/admin/reports/insurance-unlocks?${params}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        return res.json();
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setMembers([]);
          setTotalBillableDays(0);
          return;
        }
        setMembers(Array.isArray(json.members) ? json.members : []);
        setTotalBillableDays(
          typeof json.total_billable_days === "number" ? json.total_billable_days : 0
        );
        setTimezone(json.timezone ?? "");
        setTruncated(Boolean(json.truncated));
        setExpandedMember(null);
      })
      .catch(() => {
        setError("Request failed.");
        setMembers([]);
        setTotalBillableDays(0);
      })
      .finally(() => setLoading(false));
  }, [program, from, to, router]);

  useEffect(() => {
    if (from && to) load();
  }, [program, from, to, load]);

  function applyPreset(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month") {
    const r = getPresetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }

  const name = (r: { first_name: string | null; last_name: string | null; member_id: string }) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id;

  const programFilterLabel =
    program === "all" ? "All insurance programs" : INSURANCE_PROGRAM_LABELS[program];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link href="/sales" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Reports
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Insurance report</h1>
      <p className="text-stone-600 text-sm mb-6">
        For reporting, <strong>one visit per member per calendar day</strong> — the first successful door unlock that day
        (gym time). Includes members with <strong>any</strong> insurance program on file, or narrow to Optum / Tivity
        below. The table lists each member and their <strong>billable visit-day count</strong>; click a count to see every
        unlock in this range. Dates use the gym timezone
        {timezone ? ` (${timezone})` : ""}.
      </p>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 mb-6 space-y-4">
        <div>
          <span className="block text-sm font-medium text-stone-700 mb-2">Program</span>
          <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-stone-200 p-0.5 bg-stone-50">
            <button
              type="button"
              onClick={() => setProgram("all")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                program === "all" ? "bg-white shadow text-stone-900" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              All programs
            </button>
            {(["optum", "tivity"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProgram(p)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  program === p ? "bg-white shadow text-stone-900" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {INSURANCE_PROGRAM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

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
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="ml-2 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Loading…" : "Run report"}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {truncated && (
        <p className="text-amber-800 text-sm mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Loaded the first 100,000 unlock events in this range (oldest first). Very large ranges may be incomplete —
          narrow the dates so visit-day counts stay accurate.
        </p>
      )}

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 text-sm text-stone-600">
          {loading
            ? "Loading…"
            : `${totalBillableDays} billable visit day${totalBillableDays === 1 ? "" : "s"} · ${members.length} member${
                members.length === 1 ? "" : "s"
              }`}{" "}
          ({programFilterLabel})
        </div>
        {members.length === 0 && !loading ? (
          <p className="p-6 text-stone-500 text-sm">No successful unlocks in this range for the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[480px]">
              <thead>
                <tr className="bg-stone-50 text-stone-500">
                  <th className="py-2 px-4">Member</th>
                  <th className="py-2 px-4">Member ID</th>
                  <th className="py-2 px-4 min-w-[8rem]">Program</th>
                  <th className="py-2 px-4 w-40">Visit days (billable)</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const expanded = expandedMember === m.member_id;
                  return (
                    <Fragment key={m.member_id}>
                      <tr className="border-t border-stone-100">
                        <td className="py-2 px-4">
                          <Link
                            href={`/members/${m.member_id}`}
                            className="text-brand-600 hover:underline font-medium"
                          >
                            {name(m)}
                          </Link>
                        </td>
                        <td className="py-2 px-4 font-mono text-xs">{m.member_id}</td>
                        <td className="py-2 px-4 text-stone-700">{formatInsuranceProgramLabel(m.insurance_program)}</td>
                        <td className="py-2 px-4">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMember((v) => (v === m.member_id ? null : m.member_id))
                            }
                            className="text-brand-700 font-semibold tabular-nums hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 rounded"
                            aria-expanded={expanded}
                          >
                            {m.billable_days}
                          </button>
                          <span className="text-stone-400 text-xs ml-1.5">({m.all_unlocks.length} event{m.all_unlocks.length === 1 ? "" : "s"})</span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-stone-50/80">
                          <td colSpan={4} className="p-0">
                            <div className="px-4 py-3 border-t border-stone-100 text-left">
                              <p className="text-xs text-stone-500 mb-3">
                                All door events in this range (extra same-day swipes do not add billable days).
                              </p>
                              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                                <table className="w-full text-left text-sm min-w-[560px]">
                                  <thead>
                                    <tr className="bg-stone-50 text-stone-500 text-xs">
                                      <th className="py-1.5 px-3">Time</th>
                                      <th className="py-1.5 px-3">Door</th>
                                      <th className="py-1.5 px-3">Success</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.all_unlocks.map((r) => (
                                      <tr key={r.id} className="border-t border-stone-100">
                                        <td className="py-1.5 px-3 whitespace-nowrap">
                                          {formatDateTimeInAppTz(new Date(r.happened_at), undefined, tz)}
                                        </td>
                                        <td className="py-1.5 px-3">{r.lock_name ?? r.lock_id ?? "—"}</td>
                                        <td className="py-1.5 px-3">{r.success ? "Yes" : "No"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
