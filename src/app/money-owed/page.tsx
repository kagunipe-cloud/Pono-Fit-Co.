"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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
  dismissed_at?: string | null;
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

function MoneyOwedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const archived = searchParams.get("view") === "archived";

  const [rows, setRows] = useState<MoneyOwedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = archived ? "?view=archived" : "";
    fetch(`/api/admin/money-owed-report${q}`)
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
  }, [router, archived]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(
    row: MoneyOwedRow,
    action: "dismiss" | "retry_payment" | "write_off"
  ) {
    const prompts: Record<typeof action, string> = {
      dismiss:
        "Dismiss this row from Money Owed?\n\nIt will stay in Stripe history; this only hides it here.",
      retry_payment:
        "Retry payment now?\n\nWe will charge the default card on the member’s Stripe customer for the renewal amount (plus fees/tax, same as the cron). If it succeeds, their membership is extended and door access is restored (if their waiver allows).",
      write_off:
        "Write off this balance without charging?\n\nTheir monthly membership will be extended one period anyway, door access restored if waiver allows, and a $0 complimentary sale will be recorded. Use when you’ve collected cash elsewhere or are comping the period.",
    };
    if (!window.confirm(prompts[action])) return;

    setActionBusy(row.id);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/money-owed-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Request failed");
      }
      setActionMessage(typeof data.message === "string" ? data.message : "Done.");
      load();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setActionBusy(null);
    }
  }

  const emptyMessage = archived
    ? "No dismissed rows. Dismissed failures appear here for reference."
    : "No failed or skipped recurring payments on record.";

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Money Owed</h1>
      <p className="text-stone-500 mb-4">
        Recurring payments that were declined or could not be collected. Updated when the renewal cron runs. Use{" "}
        <strong className="text-stone-700">Retry payment</strong> to charge the card again, <strong className="text-stone-700">Write off</strong> to extend
        membership without charging, or <strong className="text-stone-700">Dismiss</strong> to hide a row from the open list (see{" "}
        <strong className="text-stone-700">Archived</strong>).
      </p>

      <div className="flex gap-2 mb-4 border-b border-stone-200">
        <Link
          href="/money-owed"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${!archived ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}
        >
          Open
        </Link>
        <Link
          href="/money-owed?view=archived"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${archived ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}
        >
          Archived
        </Link>
      </div>

      {actionMessage && (
        <p className="mb-4 text-sm text-stone-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{actionMessage}</p>
      )}

      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : error ? (
        <p className="p-6 text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">{emptyMessage}</div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[640px]">
            <thead>
              <tr className="bg-stone-50 text-stone-500">
                <th className="py-2 px-4">Member</th>
                <th className="py-2 px-4">Plan</th>
                <th className="py-2 px-4">Amount</th>
                <th className="py-2 px-4">Reason</th>
                <th className="py-2 px-4">Stripe code</th>
                <th className="py-2 px-4">Attempted</th>
                {archived ? <th className="py-2 px-4">Dismissed</th> : <th className="py-2 px-4 w-44">Actions</th>}
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
                  <td className="py-2 px-4 max-w-[200px]">{r.reason || "—"}</td>
                  <td className="py-2 px-4 font-mono text-xs">{r.stripe_error_code ?? "—"}</td>
                  <td className="py-2 px-4 text-stone-600 whitespace-nowrap">{formatAttemptedAt(r.attempted_at)}</td>
                  {archived ? (
                    <td className="py-2 px-4 text-stone-600 whitespace-nowrap">{formatAttemptedAt(r.dismissed_at ?? "")}</td>
                  ) : (
                    <td className="py-2 px-4 align-top">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={actionBusy === r.id}
                          onClick={() => runAction(r, "retry_payment")}
                          className="text-left text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                        >
                          Retry payment
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy === r.id}
                          onClick={() => runAction(r, "write_off")}
                          className="text-left text-xs font-medium text-stone-700 hover:underline disabled:opacity-50"
                        >
                          Write off
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy === r.id}
                          onClick={() => runAction(r, "dismiss")}
                          className="text-left text-xs text-stone-500 hover:underline disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6">
        <Link href="/sales" className="text-brand-600 hover:underline">
          Sales report
        </Link>
        {" · "}
        <Link href="/transactions" className="text-brand-600 hover:underline">
          Transactions
        </Link>
        {" · "}
        <Link href="/members" className="text-brand-600 hover:underline">
          Members
        </Link>
      </p>
    </div>
  );
}

export default function MoneyOwedPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto p-6 text-stone-500">Loading…</div>}>
      <MoneyOwedContent />
    </Suspense>
  );
}
