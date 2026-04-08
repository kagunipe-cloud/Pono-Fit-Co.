"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateForDisplay } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";

type FailedAttempt = {
  id: number;
  member_id: string;
  member_name: string;
  email: string | null;
  plan_name: string | null;
  amount_dollars: number;
  reason: string;
  stripe_error_code: string | null;
  attempted_at: string;
};

type Sale = {
  sales_id: string;
  date_time: string;
  member_id: string;
  member_name?: string | null;
  email?: string;
  status: string;
  grand_total?: string;
  tax_amount?: string | null;
  item_total?: string | null;
  cc_fee?: string | null;
};

function formatMoney(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function todayYMD(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function formatAttemptTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function TransactionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tz = useAppTimezone();
  const [txnTab, setTxnTab] = useState<"success" | "failed">("success");
  const [sales, setSales] = useState<Sale[]>([]);
  const [failedAttempts, setFailedAttempts] = useState<FailedAttempt[]>([]);
  const [expandedFailed, setExpandedFailed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [adminMemberId, setAdminMemberId] = useState("");
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();
    const cat = searchParams.get("category")?.trim();
    const dateAll = searchParams.get("date") === "all";
    if (dateAll) {
      setFromDate("all");
      setToDate("all");
    } else if (from || to) {
      setFromDate(from ?? todayYMD(tz));
      setToDate(to ?? from ?? todayYMD(tz));
    } else if (tz) {
      const t = todayYMD(tz);
      setFromDate(t);
      setToDate(t);
    }
    if (cat) setCategory(cat);
  }, [searchParams, tz]);

  useEffect(() => {
    if (tz && !fromDate && !searchParams.get("from")) {
      const t = todayYMD(tz);
      setFromDate(t);
      setToDate(t);
    }
  }, [tz, fromDate, searchParams]);

  const fetchSales = useCallback(() => {
    const useAll = fromDate === "all" || toDate === "all";
    const from = useAll ? null : (fromDate || toDate);
    const to = useAll ? null : (toDate || fromDate);
    if (!useAll && (!from || !to || from > to)) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (useAll) {
      params.set("date", "all");
    } else {
      params.set("from", from!);
      params.set("to", to!);
    }
    if (category) params.set("category", category);
    fetch(`/api/admin/sales?${params.toString()}`)
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => setSales(Array.isArray(data) ? data : []))
      .catch(() => setSales([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, category, router]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const loadFailedAttempts = useCallback(() => {
    setLoadingFailed(true);
    fetch("/api/admin/money-owed-report")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        const raw = Array.isArray(data?.attempts) ? data.attempts : [];
        setFailedAttempts(
          raw.map((a: Record<string, unknown>) => ({
            id: Number(a.id),
            member_id: String(a.member_id),
            member_name: String(a.member_name ?? a.member_id),
            email: a.email != null ? String(a.email) : null,
            plan_name: a.plan_name != null ? String(a.plan_name) : null,
            amount_dollars: typeof a.amount_dollars === "number" ? a.amount_dollars : 0,
            reason: String(a.reason ?? ""),
            stripe_error_code: a.stripe_error_code != null ? String(a.stripe_error_code) : null,
            attempted_at: String(a.attempted_at ?? ""),
          }))
        );
      })
      .catch(() => setFailedAttempts([]))
      .finally(() => setLoadingFailed(false));
  }, [router]);

  useEffect(() => {
    if (txnTab === "failed") loadFailedAttempts();
  }, [txnTab, loadFailedAttempts]);

  async function refundSale(salesId: string) {
    if (!adminMemberId.trim() && !confirm("Admin only. Enter your Admin member ID above.")) return;
    setRefundingId(salesId);
    try {
      const res = await fetch("/api/admin/sales/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(adminMemberId ? { "X-Admin-Member-Id": adminMemberId } : {}) },
        body: JSON.stringify({ sales_id: salesId }),
      });
      const json = await res.json();
      if (res.ok) setSales((prev) => prev.map((s) => (s.sales_id === salesId ? { ...s, status: "Refunded" } : s)));
      else alert(json.error ?? "Failed");
    } finally {
      setRefundingId(null);
    }
  }

  const isAllTime = fromDate === "all" || toDate === "all";
  const rangeLabel =
    isAllTime
      ? "All time"
      : fromDate && toDate
        ? fromDate === toDate
          ? formatDateForDisplay(fromDate, tz) || fromDate
          : `${formatDateForDisplay(fromDate, tz) || fromDate} – ${formatDateForDisplay(toDate, tz) || toDate}`
        : "";

  const failedByMember = new Map<string, FailedAttempt[]>();
  for (const a of failedAttempts) {
    const list = failedByMember.get(a.member_id) ?? [];
    list.push(a);
    failedByMember.set(a.member_id, list);
  }
  for (const [, list] of failedByMember) {
    list.sort((x, y) => (x.attempted_at < y.attempted_at ? 1 : -1));
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Transactions</h1>
      <p className="text-stone-500 mb-4">
        Successful purchases and failed renewal charges. For balances to collect (one row per membership), use{" "}
        <Link href="/money-owed" className="text-brand-600 hover:underline font-medium">
          Money owed
        </Link>
        .
      </p>

      <div className="flex gap-2 mb-4 border-b border-stone-200">
        <button
          type="button"
          onClick={() => setTxnTab("success")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${txnTab === "success" ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}
        >
          Successful transactions
        </button>
        <button
          type="button"
          onClick={() => setTxnTab("failed")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${txnTab === "failed" ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}
        >
          Failed transactions
        </button>
      </div>

      {txnTab === "failed" ? (
        <>
          <p className="text-sm text-stone-600 mb-4">
            Each row is a member: total counts every time the renewal cron (or a retry) attempted a charge and it failed. Expand to see each attempt — when, amount, and reason.
          </p>
          {loadingFailed ? (
            <div className="p-12 text-center text-stone-500">Loading…</div>
          ) : failedAttempts.length === 0 ? (
            <p className="p-6 text-stone-500 rounded-xl border border-stone-200 bg-white">No failed renewal charges on record.</p>
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white overflow-hidden divide-y divide-stone-100">
              {Array.from(failedByMember.entries()).map(([memberId, attempts]) => {
                const total = attempts.reduce((s, x) => s + x.amount_dollars, 0);
                const open = expandedFailed[memberId] ?? false;
                return (
                  <div key={memberId}>
                    <button
                      type="button"
                      onClick={() => setExpandedFailed((prev) => ({ ...prev, [memberId]: !open }))}
                      className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-stone-50"
                    >
                      <div>
                        <Link
                          href={`/members/${encodeURIComponent(memberId)}`}
                          className="text-brand-600 hover:underline font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {attempts[0]?.member_name ?? memberId}
                        </Link>
                        {attempts[0]?.email && <span className="block text-xs text-stone-500">{attempts[0].email}</span>}
                      </div>
                      <div className="text-sm text-stone-700">
                        <strong>{attempts.length}</strong> failed charge{attempts.length === 1 ? "" : "s"} · total{" "}
                        <strong>{formatMoney(String(total))}</strong>
                        <span className="ml-2 text-stone-400">{open ? "▼" : "▶"}</span>
                      </div>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 bg-stone-50/80">
                        <table className="w-full text-left text-sm min-w-[560px]">
                          <thead>
                            <tr className="text-stone-500 text-xs">
                              <th className="py-2 pr-2">When</th>
                              <th className="py-2 pr-2">Plan</th>
                              <th className="py-2 pr-2">Amount</th>
                              <th className="py-2 pr-2">Reason</th>
                              <th className="py-2">Stripe</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attempts.map((a) => (
                              <tr key={a.id} className="border-t border-stone-200/80">
                                <td className="py-2 pr-2 whitespace-nowrap text-stone-700">{formatAttemptTime(a.attempted_at)}</td>
                                <td className="py-2 pr-2">{a.plan_name ?? "—"}</td>
                                <td className="py-2 pr-2">{formatMoney(String(a.amount_dollars))}</td>
                                <td className="py-2 pr-2 max-w-[220px]">{a.reason || "—"}</td>
                                <td className="py-2 font-mono text-xs">{a.stripe_error_code ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
      <p className="text-stone-500 mb-4">Purchase history. Filter by date range. To refund, enter your Admin member ID and click Refund (admin only).</p>
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">From</label>
          <input
            type="date"
            value={isAllTime ? "" : fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={isAllTime}
            className="px-3 py-2 rounded-lg border border-stone-200 text-sm disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">To</label>
          <input
            type="date"
            value={isAllTime ? "" : toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={isAllTime}
            className="px-3 py-2 rounded-lg border border-stone-200 text-sm disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const t = todayYMD(tz);
            setFromDate(t);
            setToDate(t);
          }}
          className="px-3 py-2 rounded-lg border border-stone-200 text-sm font-medium hover:bg-stone-50"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => {
            setFromDate("all");
            setToDate("all");
          }}
          className={`px-3 py-2 rounded-lg border text-sm font-medium ${isAllTime ? "bg-brand-600 text-white border-brand-600" : "border-stone-200 hover:bg-stone-50"}`}
        >
          All time
        </button>
        {category && (
          <span className="px-3 py-2 rounded-lg bg-brand-100 text-brand-800 text-sm font-medium">
            {category} only
          </span>
        )}
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/80">
          <label className="block text-xs font-medium text-stone-600 mb-1">Admin member ID (for Refund)</label>
          <input
            type="text"
            value={adminMemberId}
            onChange={(e) => setAdminMemberId(e.target.value)}
            placeholder="e.g. MEM001"
            className="w-40 px-2 py-1 rounded border border-stone-200 text-sm font-mono"
          />
        </div>
      </div>
      {loading ? (
        <div className="p-12 text-center text-stone-500">Loading…</div>
      ) : sales.length === 0 ? (
        <p className="p-6 text-stone-500">No transactions for {rangeLabel || "selected date range"}.</p>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[700px]">
            <thead>
              <tr className="bg-stone-50 text-stone-500">
                <th className="py-2 px-4">Sales ID</th>
                <th className="py-2 px-4">Date</th>
                <th className="py-2 px-4">Member</th>
                <th className="py-2 px-4">Status</th>
                <th className="py-2 px-4">Item total</th>
                <th className="py-2 px-4">CC fee</th>
                <th className="py-2 px-4">Tax</th>
                <th className="py-2 px-4">Total</th>
                <th className="py-2 px-4">Admin</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.sales_id} className="border-t border-stone-100">
                  <td className="py-2 px-4 font-mono">{s.sales_id}</td>
                  <td className="py-2 px-4">{s.date_time ?? "—"}</td>
                  <td className="py-2 px-4">
                    <Link href={`/members/${encodeURIComponent(s.member_id)}`} className="text-brand-600 hover:underline">
                      {(s.member_name && s.member_name.trim()) || s.member_id}
                    </Link>
                  </td>
                  <td className="py-2 px-4">{s.status ?? "—"}</td>
                  <td className="py-2 px-4">{formatMoney(s.item_total)}</td>
                  <td className="py-2 px-4">{formatMoney(s.cc_fee)}</td>
                  <td className="py-2 px-4">{formatMoney(s.tax_amount)}</td>
                  <td className="py-2 px-4">{formatMoney(s.grand_total)}</td>
                  <td className="py-2 px-4">
                    {s.status !== "Refunded" && (
                      <button
                        type="button"
                        onClick={() => refundSale(s.sales_id)}
                        disabled={!!refundingId}
                        className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50"
                      >
                        {refundingId === s.sales_id ? "…" : "Refund"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      <p className="mt-6 text-sm">
        <Link href="/money-owed" className="text-brand-600 hover:underline">
          Money owed
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
