"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateForDisplay } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";

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

export default function TransactionsPage() {
  const router = useRouter();
  const tz = useAppTimezone();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminMemberId, setAdminMemberId] = useState("");
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => {
    if (!selectedDate && tz) setSelectedDate(todayYMD(tz));
  }, [tz, selectedDate]);

  const fetchSales = useCallback(() => {
    if (!selectedDate) return;
    setLoading(true);
    fetch(`/api/admin/sales?date=${encodeURIComponent(selectedDate)}`)
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
  }, [selectedDate, router]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

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

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Transactions</h1>
      <p className="text-stone-500 mb-4">Purchase history. Filter by date. To refund, enter your Admin member ID and click Refund (admin only).</p>
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Date</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-stone-200 text-sm"
            />
            <button
              type="button"
              onClick={() => setSelectedDate(todayYMD(tz))}
              className="px-3 py-2 rounded-lg border border-stone-200 text-sm font-medium hover:bg-stone-50"
            >
              Today
            </button>
          </div>
        </div>
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
        <p className="p-6 text-stone-500">No transactions for {formatDateForDisplay(selectedDate, tz) || selectedDate}.</p>
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
      <p className="mt-4">
        <Link href="/sales" className="text-brand-600 hover:underline">Sales report</Link>
        {" · "}
        <Link href="/members" className="text-brand-600 hover:underline">Members</Link>
      </p>
    </div>
  );
}
