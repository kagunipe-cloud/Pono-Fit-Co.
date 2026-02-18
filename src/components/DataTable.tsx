"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import type { ColumnDef } from "@/lib/sections";

type DataTableProps = {
  sectionSlug: string;
  title: string;
  description: string;
  columns: ColumnDef[];
  searchPlaceholder?: string;
  initialData?: Record<string, unknown>[];
  initialSearch?: string;
  actionHref?: string;
  actionLabel?: string;
};

export default function DataTable({
  sectionSlug,
  title,
  description,
  columns,
  searchPlaceholder = "Search...",
  initialData = [],
  initialSearch = "",
  actionHref,
  actionLabel,
}: DataTableProps) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(initialData);
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialDone = useRef(false);

  useEffect(() => {
    setRows(initialData);
    setSearch(initialSearch);
    setDebouncedSearch(initialSearch);
    initialDone.current = false;
  }, [sectionSlug, initialData, initialSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const url = query
          ? `/api/data/${sectionSlug}?q=${encodeURIComponent(query)}`
          : `/api/data/${sectionSlug}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load data");
        const data = await res.json();
        setRows(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [sectionSlug]
  );

  useEffect(() => {
    if (initialDone.current) {
      fetchData(debouncedSearch);
    } else {
      initialDone.current = true;
    }
  }, [debouncedSearch]);

  const displayValue = (row: Record<string, unknown>, key: string): string => {
    const v = row[key];
    if (v == null || v === "") return "—";
    if (key === "role" && String(v) === "Admin") return String(v);
    return String(v);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            {title}
          </h1>
          <p className="text-stone-500 mt-1">{description}</p>
        </div>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 shrink-0"
          >
            {actionLabel}
          </Link>
        )}
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex flex-wrap items-center gap-3">
          <label htmlFor="search" className="sr-only">
            Search
          </label>
          <input
            id="search"
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(e.target.value)
            }
            className="flex-1 min-w-[200px] px-4 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <span className="text-sm text-stone-400">
            {rows.length} row{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          {error && (
            <div className="p-6 text-center text-red-600 bg-red-50 border-b border-red-100">
              {error}
            </div>
          )}
          {loading ? (
            <div className="p-12 text-center text-stone-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-stone-500">
              No data found. Run{" "}
              <code className="bg-stone-100 px-1.5 py-0.5 rounded">
                npm run import
              </code>{" "}
              to load data from CSV.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                  {columns.map((col) => (
                    <th key={col.key} className="py-3 px-4">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={(row.id as number) ?? i}
                    className="border-t border-stone-100 hover:bg-brand-50/30 transition-colors"
                  >
                    {columns.map((col) => {
                      const val = displayValue(row, col.key);
                      const isRoleAdmin = col.key === "role" && val === "Admin";
                      return (
                        <td
                          key={col.key}
                          className={`py-3 px-4 ${col.key === "role" && isRoleAdmin ? "" : "text-stone-600"}`}
                        >
                          {col.key === "role" && isRoleAdmin ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-800">
                              {val}
                            </span>
                          ) : (
                            <span
                              className={
                                ["member_id", "sales_id", "product_id", "subscription_id", "line_item_id", "class_booking_id", "pt_booking_id"].includes(col.key)
                                  ? "text-stone-400 text-sm font-mono"
                                  : ""
                              }
                            >
                              {val}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
