"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type MoneyOwedAggregatedRow = {
  member_id: string;
  member_name: string;
  email: string | null;
  subscription_id: string | null;
  plan_name: string | null;
  amount_cents: number | null;
  amount_dollars: number;
  attempt_count: number;
  sum_amount_cents: number;
  sum_amount_dollars: number;
  latest_reason: string;
  latest_stripe_error_code: string | null;
  first_attempted_at: string;
  last_attempted_at: string;
  failure_ids: number[];
};

function formatMoney(n: number): string {
  if (Number.isNaN(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
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

function groupKey(r: MoneyOwedAggregatedRow): string {
  return `${r.member_id}::${r.subscription_id ?? ""}`;
}

function MoneyOwedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const archived = searchParams.get("view") === "archived";

  const [rows, setRows] = useState<MoneyOwedAggregatedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState<string | null>(null);
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
        if (Array.isArray(data?.aggregated)) setRows(data.aggregated);
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

  async function runAction(row: MoneyOwedAggregatedRow, action: "dismiss" | "retry_payment" | "write_off") {
    const prompts: Record<typeof action, string> = {
      dismiss:
        "Dismiss this balance from Money Owed?\n\nAll recorded retry attempts for this membership will be archived. Stripe history is unchanged.",
      retry_payment:
        "Retry payment now?\n\nWe will charge the default card once for this renewal (plus fees/tax, same as the cron). If it succeeds, the membership is extended and door access restored if the waiver allows.",
      write_off:
        "Write off this balance without charging?\n\nTheir monthly membership will be extended one period, door access restored if the waiver allows, and a $0 complimentary sale will be recorded.",
    };
    if (!window.confirm(prompts[action])) return;

    setActionBusy(groupKey(row));
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/money-owed-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          member_id: row.member_id,
          subscription_id: row.subscription_id,
        }),
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

  async function sendReminder(row: MoneyOwedAggregatedRow) {
    if (!row.email?.trim()) {
      setActionMessage("Add an email on this member’s profile before sending a reminder.");
      return;
    }
    setEmailBusy(groupKey(row));
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/money-owed-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: row.member_id,
          subscription_id: row.subscription_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Request failed");
      }
      setActionMessage(typeof data.message === "string" ? data.message : "Reminder sent.");
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setEmailBusy(null);
    }
  }

  const emptyMessage = archived
    ? "No dismissed balances. Dismissed failures appear here for reference."
    : "No failed recurring payments on record.";

  const byMember = new Map<string, MoneyOwedAggregatedRow[]>();
  for (const r of rows) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }
  const memberOrder = Array.from(byMember.keys());

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Money owed</h1>
      <p className="text-stone-500 mb-4">
        One line per membership that still needs payment — <strong className="text-stone-700">amount</strong> is the renewal price (not multiplied by retry attempts). For every cron attempt
        (same member + subscription), see <Link href="/transactions" className="text-brand-600 hover:underline font-medium">Transactions → Failed transactions</Link>.
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
        <div className="space-y-8">
          {memberOrder.map((mid) => {
            const subs = byMember.get(mid)!;
            const first = subs[0]!;
            return (
              <div key={mid} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                <div className="bg-stone-50 px-4 py-2 border-b border-stone-100">
                  <Link href={`/members/${encodeURIComponent(mid)}`} className="text-brand-600 hover:underline font-semibold">
                    {first.member_name || mid}
                  </Link>
                  {first.email && <span className="ml-2 text-sm text-stone-500">{first.email}</span>}
                </div>
                <div className="divide-y divide-stone-100">
                  {subs.map((r) => (
                    <div key={groupKey(r)} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium text-stone-800">{r.plan_name ?? "—"}</p>
                        <p className="text-sm text-stone-600">
                          <span className="font-medium text-stone-800">{formatMoney(r.amount_dollars)}</span> owed
                          {r.attempt_count > 1 && (
                            <span className="text-stone-500">
                              {" "}
                              · {r.attempt_count} attempts (last: {r.latest_reason || "—"}
                              {r.latest_stripe_error_code ? ` · ${r.latest_stripe_error_code}` : ""})
                            </span>
                          )}
                          {r.attempt_count === 1 && (
                            <span className="text-stone-500">
                              {" "}
                              · {r.latest_reason || "—"}
                              {r.latest_stripe_error_code ? ` · ${r.latest_stripe_error_code}` : ""}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-500">
                          Last try: {formatAttemptedAt(r.last_attempted_at)}
                          {r.first_attempted_at !== r.last_attempted_at && (
                            <> · First: {formatAttemptedAt(r.first_attempted_at)}</>
                          )}
                        </p>
                      </div>
                      {!archived && (
                        <div className="flex flex-col gap-1 shrink-0 sm:min-w-[11rem]">
                          <button
                            type="button"
                            disabled={
                              emailBusy === groupKey(r) ||
                              actionBusy === groupKey(r) ||
                              !r.email?.trim()
                            }
                            onClick={() => sendReminder(r)}
                            title={!r.email?.trim() ? "Member has no email on file" : undefined}
                            className="text-left text-xs font-medium text-stone-800 hover:underline disabled:opacity-50"
                          >
                            {emailBusy === groupKey(r) ? "Sending…" : "Send email reminder"}
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy === groupKey(r) || emailBusy === groupKey(r)}
                            onClick={() => runAction(r, "retry_payment")}
                            className="text-left text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Retry payment
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy === groupKey(r) || emailBusy === groupKey(r)}
                            onClick={() => runAction(r, "write_off")}
                            className="text-left text-xs font-medium text-stone-700 hover:underline disabled:opacity-50"
                          >
                            Write off
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy === groupKey(r) || emailBusy === groupKey(r)}
                            onClick={() => runAction(r, "dismiss")}
                            className="text-left text-xs text-stone-500 hover:underline disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6">
        <Link href="/transactions" className="text-brand-600 hover:underline">
          Transactions
        </Link>
        {" · "}
        <Link href="/sales" className="text-brand-600 hover:underline">
          Sales report
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
