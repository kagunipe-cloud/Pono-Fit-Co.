"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Tab = "class" | "pt" | "pass";

type OpenCreditsClassRow = { member_id: string; member_name: string; credits: number };
type OpenCreditsPtRow = {
  member_id: string;
  member_name: string;
  buckets: { duration_minutes: number; credits: number }[];
};
type OpenCreditsGiftRow = {
  kind: "gift_pending";
  id: number;
  recipient_email: string;
  plan_name: string | null;
  created_at: string | null;
  purchaser_name: string;
  purchaser_member_id: string;
};
type OpenCreditsPassSubRow = {
  kind: "subscription";
  subscription_id: string | null;
  member_id: string;
  member_name: string;
  plan_name: string | null;
  pass_credits_remaining: number;
  pass_activation_day: string | null;
  status: string | null;
};

export function OpenCreditsClient() {
  const [tab, setTab] = useState<Tab>("class");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [classRows, setClassRows] = useState<OpenCreditsClassRow[]>([]);
  const [ptRows, setPtRows] = useState<OpenCreditsPtRow[]>([]);
  const [gifts, setGifts] = useState<OpenCreditsGiftRow[]>([]);
  const [passSubs, setPassSubs] = useState<OpenCreditsPassSubRow[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchTab = useCallback(async (active: Tab, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab: active });
      if (q) params.set("q", q);
      const res = await fetch(`/api/data/open-credits?${params}`);
      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (active === "class") setClassRows(data.rows ?? []);
      else if (active === "pt") setPtRows(data.rows ?? []);
      else {
        setGifts(data.gifts ?? []);
        setPassSubs(data.subscriptions ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTab(tab, debouncedSearch);
  }, [tab, debouncedSearch, fetchTab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "class", label: "Class Credits" },
    { id: "pt", label: "PT Credits" },
    { id: "pass", label: "Pass-Pack Credits" },
  ];

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-stone-100 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-brand-600 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4 border-b border-stone-100 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder={
            tab === "pass" ? "Search email, member, plan…" : "Search member name or ID…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
        />
      </div>
      {error && (
        <div className="p-6 text-center text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}
      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : tab === "class" ? (
        <ClassTable rows={classRows} />
      ) : tab === "pt" ? (
        <PtTable rows={ptRows} />
      ) : (
        <PassTables gifts={gifts} subscriptions={passSubs} />
      )}
    </div>
  );
}

function ClassTable({ rows }: { rows: OpenCreditsClassRow[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-stone-500">No members with class credits.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
            <th className="py-3 px-4">Member</th>
            <th className="py-3 px-4">Member ID</th>
            <th className="py-3 px-4">Credits</th>
            <th className="py-3 px-4 w-24"> </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.member_id} className="border-t border-stone-100 hover:bg-brand-50/30">
              <td className="py-3 px-4 text-stone-700">{r.member_name}</td>
              <td className="py-3 px-4 text-stone-600 font-mono text-sm">{r.member_id}</td>
              <td className="py-3 px-4 text-stone-800 font-medium">{r.credits}</td>
              <td className="py-3 px-4">
                <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="text-sm text-brand-600 hover:underline">
                  Profile
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PtTable({ rows }: { rows: OpenCreditsPtRow[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-stone-500">No members with PT credits.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
            <th className="py-3 px-4">Member</th>
            <th className="py-3 px-4">Member ID</th>
            <th className="py-3 px-4">By length (min)</th>
            <th className="py-3 px-4 w-24"> </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.member_id} className="border-t border-stone-100 hover:bg-brand-50/30">
              <td className="py-3 px-4 text-stone-700">{r.member_name}</td>
              <td className="py-3 px-4 text-stone-600 font-mono text-sm">{r.member_id}</td>
              <td className="py-3 px-4 text-stone-700 text-sm">
                {r.buckets
                  .map((b) => `${b.duration_minutes}′ × ${b.credits}`)
                  .join(" · ")}
              </td>
              <td className="py-3 px-4">
                <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="text-sm text-brand-600 hover:underline">
                  Profile
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PassTables({ gifts, subscriptions }: { gifts: OpenCreditsGiftRow[]; subscriptions: OpenCreditsPassSubRow[] }) {
  const hasAny = gifts.length > 0 || subscriptions.length > 0;
  if (!hasAny) {
    return (
      <div className="p-12 text-center text-stone-500">
        No pending gift passes or active pass-pack balances.
      </div>
    );
  }
  return (
    <div className="divide-y divide-stone-100">
      {gifts.length > 0 && (
        <div className="p-4">
          <h3 className="text-sm font-semibold text-stone-800 mb-3">Pending gifts (not redeemed)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-stone-500 font-medium">
                  <th className="py-2 px-3">Recipient email</th>
                  <th className="py-2 px-3">Plan</th>
                  <th className="py-2 px-3">Purchaser</th>
                  <th className="py-2 px-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => (
                  <tr key={g.id} className="border-t border-stone-100">
                    <td className="py-2 px-3 text-stone-700">{g.recipient_email}</td>
                    <td className="py-2 px-3 text-stone-600">{g.plan_name ?? "—"}</td>
                    <td className="py-2 px-3">
                      <Link href={`/members/${encodeURIComponent(g.purchaser_member_id)}`} className="text-brand-600 hover:underline">
                        {g.purchaser_name}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-stone-500">{g.created_at ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {subscriptions.length > 0 && (
        <div className="p-4">
          <h3 className="text-sm font-semibold text-stone-800 mb-3">Redeemed packs — days left in bank</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-stone-500 font-medium">
                  <th className="py-2 px-3">Member</th>
                  <th className="py-2 px-3">Member ID</th>
                  <th className="py-2 px-3">Plan</th>
                  <th className="py-2 px-3">Days left</th>
                  <th className="py-2 px-3">Last activated</th>
                  <th className="py-2 px-3 w-20"> </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s, idx) => (
                  <tr key={`${s.member_id}-${s.subscription_id ?? "sub"}-${idx}`} className="border-t border-stone-100">
                    <td className="py-2 px-3 text-stone-700">{s.member_name}</td>
                    <td className="py-2 px-3 font-mono text-stone-600">{s.member_id}</td>
                    <td className="py-2 px-3 text-stone-600">{s.plan_name ?? "—"}</td>
                    <td className="py-2 px-3 font-medium text-stone-800">{s.pass_credits_remaining}</td>
                    <td className="py-2 px-3 text-stone-500">{s.pass_activation_day?.trim() ? s.pass_activation_day : "—"}</td>
                    <td className="py-2 px-3">
                      <Link href={`/members/${encodeURIComponent(s.member_id)}`} className="text-brand-600 hover:underline">
                        Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
