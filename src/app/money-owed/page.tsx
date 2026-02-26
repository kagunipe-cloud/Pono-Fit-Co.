"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type MoneyOwedRow = {
  id: number;
  member_id: string;
  member_name: string;
  email: string | null;
  subscription_id: string | null;
  plan_name: string | null;
  amount_cents: number | null;
  amount_dollars: number;
  reason: string;
  stripe_error_code: string | null;
  attempted_at: string;
};

function formatMoney(n: number): string {
  if (Number.isNaN(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function formatAttemptedAt(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function MoneyOwedPage() {
  const router = useRouter();
  const [rows, setRows] = useState<MoneyOwedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/money-owed-report")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.rows) setRows(data.rows);
        else setRows([]);
      })
      .catch(() => {
        setError("Failed to load report");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Money Owed</h1>
      <p className="text-stone-500 mb-6">
        Recurring payments that were declined or could not be collected. Updated when the renewal cron runs. Fix by having the member update their card or contact support.
      </p>

      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : error ? (
        <p className="p-6 text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">
          No failed or skipped recurring payments on record.
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-stone-50 text-stone-500">
                <th className="py-2 px-4">Member</th>
                <th className="py-2 px-4">Plan</th>
                <th className="py-2 px-4">Amount</th>
                <th className="py-2 px-4">Reason</th>
                <th className="py-2 px-4">Stripe code</th>
                <th className="py-2 px-4">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="py-2 px-4">
                    <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="text-brand-600 hover:underline font-medium">
                      {r.member_name || r.member_id}
                    </Link>
                    {r.email && <span className="block text-xs text-stone-500">{r.email}</span>}
                  </td>
                  <td className="py-2 px-4">{r.plan_name ?? "—"}</td>
                  <td className="py-2 px-4">{formatMoney(r.amount_dollars)}</td>
                  <td className="py-2 px-4">{r.reason || "—"}</td>
                  <td className="py-2 px-4 font-mono text-xs">{r.stripe_error_code ?? "—"}</td>
                  <td className="py-2 px-4 text-stone-600">{formatAttemptedAt(r.attempted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6">
        <Link href="/sales" className="text-brand-600 hover:underline">Sales report</Link>
        {" · "}
        <Link href="/transactions" className="text-brand-600 hover:underline">Transactions</Link>
        {" · "}
        <Link href="/members" className="text-brand-600 hover:underline">Members</Link>
      </p>
    </div>
  );
}
