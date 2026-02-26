"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type CategoryRow = { category: string; count: number; revenue: number };
type Report = { totalCount: number; totalRevenue: number; byCategory: CategoryRow[]; from: string | null; to: string | null } | null;

function formatMoney(n: number): string {
  if (Number.isNaN(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month"): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "today") {
    return { from: toYMD(today), to: toYMD(today) };
  }

  if (preset === "this-week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toYMD(monday), to: toYMD(sunday) };
  }

  if (preset === "this-month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: toYMD(first), to: toYMD(last) };
  }

  if (preset === "last-week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + mondayOffset);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { from: toYMD(lastMonday), to: toYMD(lastSunday) };
  }

  // last-month
  const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthEnd = new Date(firstThisMonth);
  lastMonthEnd.setDate(0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return { from: toYMD(lastMonthStart), to: toYMD(lastMonthEnd) };
}

export default function SalesPage() {
  const router = useRouter();
  const [report, setReport] = useState<Report>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activePreset, setActivePreset] = useState<"today" | "this-week" | "this-month" | "last-week" | "last-month" | "custom" | null>(null);

  const fetchReport = useCallback((fromVal: string, toVal: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromVal && toVal) {
      params.set("from", fromVal);
      params.set("to", toVal);
    }
    fetch(`/api/admin/sales-report?${params.toString()}`)
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => setReport(data ?? null))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    fetchReport(from, to);
  }, [from, to, fetchReport]);

  function applyPreset(preset: "today" | "this-week" | "this-month" | "last-week" | "last-month") {
    const { from: f, to: t } = getPresetRange(preset);
    setFrom(f);
    setTo(t);
    setActivePreset(preset);
    setCustomFrom(f);
    setCustomTo(t);
  }

  function applyCustomRange() {
    if (customFrom && customTo && customFrom <= customTo) {
      setFrom(customFrom);
      setTo(customTo);
      setActivePreset("custom");
    }
  }

  function clearRange() {
    setFrom("");
    setTo("");
    setCustomFrom("");
    setCustomTo("");
    setActivePreset(null);
  }

  const rangeLabel = report?.from && report?.to
    ? `${report.from} – ${report.to}`
    : "All time";

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Sales</h1>
      <p className="text-stone-500 mb-4">Transactions by category. Refunds are excluded. Filter by date range below.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={clearRange}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === null && !from ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          All time
        </button>
        <button
          type="button"
          onClick={() => applyPreset("today")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === "today" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => applyPreset("this-week")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === "this-week" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          This Week
        </button>
        <button
          type="button"
          onClick={() => applyPreset("this-month")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === "this-month" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          This Month
        </button>
        <button
          type="button"
          onClick={() => applyPreset("last-week")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === "last-week" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          Last Week
        </button>
        <button
          type="button"
          onClick={() => applyPreset("last-month")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activePreset === "last-month" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          Last Month
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6 p-3 rounded-lg border border-stone-200 bg-stone-50/50">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">From</label>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="px-2 py-1.5 rounded border border-stone-200 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">To</label>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="px-2 py-1.5 rounded border border-stone-200 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={applyCustomRange}
          className="px-3 py-1.5 rounded-lg bg-stone-200 text-stone-800 text-sm font-medium hover:bg-stone-300"
        >
          Apply date range
        </button>
      </div>

      {report?.from != null && report?.to != null && (
        <p className="text-sm text-stone-500 mb-4">Showing: {rangeLabel}</p>
      )}

      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : !report ? (
        <p className="p-6 text-stone-500">Could not load report.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Transactions</p>
              <p className="text-2xl font-bold text-stone-800 mt-1">{report.totalCount}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Total revenue</p>
              <p className="text-2xl font-bold text-stone-800 mt-1">{formatMoney(report.totalRevenue)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-stone-50 text-stone-500">
                  <th className="py-2 px-4">Category</th>
                  <th className="py-2 px-4">Count</th>
                  <th className="py-2 px-4">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map((row) => (
                  <tr key={row.category} className="border-t border-stone-100">
                    <td className="py-2 px-4 font-medium text-stone-800">{row.category}</td>
                    <td className="py-2 px-4">{row.count}</td>
                    <td className="py-2 px-4">{formatMoney(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-6">
        <Link href="/transactions" className="text-brand-600 hover:underline">View all transactions</Link>
        {" · "}
        <Link href="/members" className="text-brand-600 hover:underline">Members</Link>
      </p>
    </div>
  );
}
