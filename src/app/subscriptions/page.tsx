"use client";

import { useEffect, useState, useCallback } from "react";

type SubReportRow = {
  id: number;
  subscription_id: string;
  member_id: string;
  product_id: string;
  member_name: string;
  plan_name: string;
  status: string;
  start_date: string;
  expiry_date: string;
  days_remaining: string;
  price: string;
};

const COLUMNS = [
  { key: "member_name", label: "Member Name" },
  { key: "plan_name", label: "Subscription Name" },
  { key: "status", label: "Status" },
  { key: "start_date", label: "Start date" },
  { key: "expiry_date", label: "Expiry date" },
  { key: "days_remaining", label: "Days remaining" },
  { key: "price", label: "Price" },
] as const;

type StatusFilter = "all" | "Active" | "Cancelled";

export default function SubscriptionsPage() {
  const [rows, setRows] = useState<SubReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/data/subscriptions-report?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load subscriptions");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const displayValue = (row: SubReportRow, key: string): string => {
    const v = row[key as keyof SubReportRow];
    if (v == null || v === "") return "—";
    return String(v);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Subscriptions</h1>
        <p className="text-stone-500 mt-1">Active and cancelled subscriptions</p>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-stone-600">Status:</span>
            {(["all", "Active", "Cancelled"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  statusFilter === status ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                }`}
              >
                {status === "all" ? "All" : status}
              </button>
            ))}
          </div>
          <label htmlFor="sub-search" className="sr-only">Search</label>
          <input
            id="sub-search"
            type="search"
            placeholder="Search by member or plan name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <span className="text-sm text-stone-400">
            {rows.length} row{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        {error && (
          <div className="p-6 text-center text-red-600 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No subscriptions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="py-3 px-4">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-stone-100 hover:bg-brand-50/30 transition-colors"
                  >
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="py-3 px-4 text-stone-600">
                        {col.key === "status" && row.status === "Active" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-800">
                            {displayValue(row, col.key)}
                          </span>
                        ) : col.key === "status" && row.status === "Cancelled" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-stone-200 text-stone-700">
                            {displayValue(row, col.key)}
                          </span>
                        ) : (
                          displayValue(row, col.key)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
