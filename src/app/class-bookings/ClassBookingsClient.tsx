"use client";

import { useEffect, useState, useCallback } from "react";

type Row = {
  source: string;
  id: number | string;
  member_name: string;
  transaction_datetime: string;
  session_datetime: string;
  status: "active" | "fulfilled";
  class_name: string;
  payment_type: string;
  cancel_type?: string;
  cancel_id?: number;
};

export function ClassBookingsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = query
        ? `/api/data/class-bookings-unified?q=${encodeURIComponent(query)}`
        : "/api/data/class-bookings-unified";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(debouncedSearch);
  }, [debouncedSearch, fetchData]);

  const display = (v: unknown) => (v == null || v === "" ? "—" : String(v));

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-stone-100 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search class bookings..."
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
        <div className="p-12 text-center text-stone-500">No class bookings found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Transaction</th>
                <th className="py-3 px-4">Session</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Class</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.source}-${row.id}-${i}`}
                  className={`border-t border-stone-100 hover:bg-brand-50/30 transition-colors ${
                    row.status === "fulfilled" ? "bg-emerald-50/50" : ""
                  }`}
                >
                  <td className="py-3 px-4 text-stone-600">{display(row.source)}</td>
                  <td className="py-3 px-4 text-stone-600">{display(row.member_name)}</td>
                  <td className="py-3 px-4 text-stone-600">{display(row.transaction_datetime)}</td>
                  <td className="py-3 px-4 text-stone-600">{display(row.session_datetime)}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        row.status === "fulfilled"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {row.status === "fulfilled" ? "Fulfilled" : "Active"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-stone-600">{display(row.class_name)}</td>
                  <td className="py-3 px-4 text-stone-600">{display(row.payment_type)}</td>
                  <td className="py-3 px-4">
                    {row.cancel_type === "occurrence" && row.cancel_id != null ? (
                      <button
                        type="button"
                        onClick={() => handleCancel(row)}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                      >
                        Cancel
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
