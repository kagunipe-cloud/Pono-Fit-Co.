"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Member = {
  id: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  join_date: string | null;
  exp_next_payment_date: string | null;
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            Members
          </h1>
          <p className="text-stone-500 mt-1">Manage members and view linked subscriptions, bookings, and sales</p>
        </div>
        <Link
          href="/members/new"
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition-colors"
        >
          Add member
        </Link>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search by name, email, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <span className="text-sm text-stone-400">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          {error && (
            <div className="p-6 text-center text-red-600 bg-red-50">
              {error}
            </div>
          )}
          {loading ? (
            <div className="p-12 text-center text-stone-500">Loading…</div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center text-stone-500">
              No members found.{" "}
              <Link href="/members/new" className="text-brand-600 hover:underline">
                Add your first member
              </Link>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Join date</th>
                  <th className="py-3 px-4">Renewal date</th>
                  <th className="py-3 px-4">Member ID</th>
                  <th className="py-3 px-4 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t border-stone-100 hover:bg-brand-50/30 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-stone-800">
                      <Link href={`/members/${m.id}`} className="hover:text-brand-700 hover:underline">
                        {[m.first_name, m.last_name].filter(Boolean).join(" ") || "—"}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-stone-600">{m.email ?? "—"}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          m.role === "Admin" ? "bg-brand-100 text-brand-800" : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {m.role ?? "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-stone-600">{m.join_date ?? "—"}</td>
                    <td className="py-3 px-4 text-stone-600">{m.exp_next_payment_date ?? "—"}</td>
                    <td className="py-3 px-4 text-stone-400 text-sm font-mono">{m.member_id}</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/members/${m.id}`}
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
