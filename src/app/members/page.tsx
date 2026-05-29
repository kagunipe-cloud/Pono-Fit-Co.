"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatDateForDisplay } from "@/lib/app-timezone";

export type MemberType = "Monthly" | "Day pass" | "Week pass" | "Class client" | "PT client";
type MemberTypeFilter = MemberType | "Monthly recurring";

type Member = {
  id: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  join_date: string | null;
  exp_next_payment_date: string | null;
  active: boolean;
  types: MemberType[];
  auto_renew_recurring?: boolean;
};

const MEMBER_TYPES: MemberType[] = ["Monthly", "Day pass", "Week pass", "Class client", "PT client"];
const TYPE_FILTERS: MemberTypeFilter[] = [...MEMBER_TYPES, "Monthly recurring"];

type SortKey = "name" | "email" | "type" | "role" | "join_date" | "renewal" | "member_id";

function memberDisplayName(m: Member): string {
  return [m.first_name, m.last_name].filter(Boolean).join(" ") || "";
}

function memberTypeSortLabel(m: Member): string {
  return [...(m.types ?? [])].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Empty dates sort after non-empty when ascending. */
function compareDateStrings(a: string | null, b: string | null): number {
  const as = String(a ?? "").trim();
  const bs = String(b ?? "").trim();
  if (!as && !bs) return 0;
  if (!as) return 1;
  if (!bs) return -1;
  return as.localeCompare(bs);
}

function sortMembers(list: Member[], key: SortKey, dir: "asc" | "desc"): Member[] {
  const next = [...list];
  const mul = dir === "asc" ? 1 : -1;
  const cmp = (a: Member, b: Member): number => {
    let c = 0;
    switch (key) {
      case "name":
        c = memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: "base" });
        break;
      case "email":
        c = (a.email ?? "").localeCompare(b.email ?? "", undefined, { sensitivity: "base" });
        break;
      case "type":
        c = memberTypeSortLabel(a).localeCompare(memberTypeSortLabel(b), undefined, { sensitivity: "base" });
        break;
      case "role":
        c = (a.role ?? "").localeCompare(b.role ?? "", undefined, { sensitivity: "base" });
        break;
      case "join_date":
        c = compareDateStrings(a.join_date, b.join_date);
        break;
      case "renewal":
        c = compareDateStrings(a.exp_next_payment_date, b.exp_next_payment_date);
        break;
      case "member_id":
        c = (a.member_id ?? "").localeCompare(b.member_id ?? "", undefined, { sensitivity: "base" });
        break;
      default:
        c = 0;
    }
    if (c !== 0) return mul * c;
    return (a.member_id ?? "").localeCompare(b.member_id ?? "", undefined, { sensitivity: "base" });
  };
  next.sort(cmp);
  return next;
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<MemberTypeFilter | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchMembers = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = query
        ? `/api/members?q=${encodeURIComponent(query)}`
        : "/api/members";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load members");
      const data = await res.json();
      setMembers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers(debouncedSearch);
  }, [debouncedSearch, fetchMembers]);

  const filteredMembers = useMemo(() => {
    let list = members;
    if (activeFilter === "active") list = list.filter((m) => m.active);
    if (activeFilter === "inactive") list = list.filter((m) => !m.active);
    if (typeFilter === "Monthly recurring") list = list.filter((m) => m.auto_renew_recurring);
    else if (typeFilter) list = list.filter((m) => m.types?.includes(typeFilter));
    return list;
  }, [members, activeFilter, typeFilter]);

  const sortedMembers = useMemo(
    () => sortMembers(filteredMembers, sort.key, sort.dir),
    [filteredMembers, sort.key, sort.dir]
  );

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            Members
          </h1>
          <p className="text-stone-500 mt-1">Manage members and view linked subscriptions, bookings, and sales</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/email-members"
            className="inline-flex items-center px-4 py-2.5 rounded-lg border border-stone-200 bg-white text-stone-700 font-medium hover:bg-stone-50 transition-colors"
          >
            Email members
          </Link>
          <Link
            href="/members/new"
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition-colors"
          >
            Add member
          </Link>
        </div>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Search by name, email, role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-4 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
            <span className="text-sm text-stone-400">
              {sortedMembers.length} of {members.length} member{members.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">Access</span>
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                activeFilter === "all" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("active")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                activeFilter === "active" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("inactive")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                activeFilter === "inactive" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              Non-active
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">Type</span>
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                typeFilter === null ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              All types
            </button>
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  typeFilter === t ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {error && (
            <div className="p-6 text-center text-red-600 bg-red-50">
              {error}
            </div>
          )}
          {loading ? (
            <div className="p-12 text-center text-stone-500">Loading…</div>
          ) : sortedMembers.length === 0 ? (
            <div className="p-12 text-center text-stone-500">
              No members match the current filters.
              {members.length === 0 && (
                <>{" "}
                  <Link href="/members/new" className="text-brand-600 hover:underline">
                    Add your first member
                  </Link>
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                  {(
                    [
                      { key: "name" as const, label: "Name" },
                      { key: "email" as const, label: "Email" },
                      { key: "type" as const, label: "Type" },
                      { key: "role" as const, label: "Role" },
                      { key: "join_date" as const, label: "Join date" },
                      { key: "renewal" as const, label: "Renewal date" },
                      { key: "member_id" as const, label: "Member ID" },
                    ] as const
                  ).map(({ key, label }) => (
                    <th key={key} className="py-3 px-4" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className={`inline-flex items-center gap-1 font-medium text-stone-500 hover:text-stone-800 -mx-1 px-1 rounded ${sort.key === key ? "text-stone-800" : ""}`}
                      >
                        {label}
                        <span className="text-xs font-normal text-stone-400 tabular-nums w-3" aria-hidden>
                          {sort.key === key ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="py-3 px-4 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {sortedMembers.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t border-stone-100 hover:bg-brand-50/30 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-stone-800">
                      <Link href={`/members/${m.member_id}`} className="hover:text-brand-700 hover:underline">
                        {[m.first_name, m.last_name].filter(Boolean).join(" ") || "—"}
                      </Link>
                      {m.active && (
                        <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Active</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-stone-600">{m.email ?? "—"}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(m.types ?? []).length === 0 ? (
                          <span className="text-stone-400">—</span>
                        ) : (
                          (m.types ?? []).map((t) => (
                            <span
                              key={t}
                              className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-700"
                            >
                              {t}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          m.role === "Admin" ? "bg-brand-100 text-brand-800" : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {m.role ?? "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-stone-600">{formatDateForDisplay(m.join_date) || "—"}</td>
                    <td className="py-3 px-4 text-stone-600">{formatDateForDisplay(m.exp_next_payment_date) || "—"}</td>
                    <td className="py-3 px-4 text-stone-400 text-sm font-mono">{m.member_id}</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/members/${m.member_id}`}
                        className="text-brand-600 hover:underline text-sm font-medium"
                      >
                        View →
                      </Link>
                    </td>
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
