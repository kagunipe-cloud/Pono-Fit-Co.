"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Discount = {
  id: number;
  code: string;
  percent_off: number;
  description: string | null;
  scope: string;
};

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function fetchDiscounts() {
    try {
      const res = await fetch("/api/admin/discounts");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDiscounts(data);
    } catch {
      setDiscounts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDiscounts();
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this discount?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/discounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchDiscounts();
    } catch {
      alert("Could not delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to Settings</Link>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            Discounts
          </h1>
          <p className="text-stone-500 mt-1">Promo codes for cart and item discounts. Members enter codes at checkout.</p>
        </div>
        <Link
          href="/discounts/new"
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add discount
        </Link>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : discounts.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No discounts yet.{" "}
            <Link href="/discounts/new" className="text-brand-600 hover:underline">Add your first discount</Link>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Percent off</th>
                <th className="py-3 px-4">Scope</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-t border-stone-100 hover:bg-brand-50/30">
                  <td className="py-3 px-4 font-mono font-medium text-stone-800">{d.code}</td>
                  <td className="py-3 px-4 text-stone-600">{d.percent_off}%</td>
                  <td className="py-3 px-4 text-stone-600 capitalize">{d.scope ?? "cart"}</td>
                  <td className="py-3 px-4 text-stone-600">{d.description ?? "—"}</td>
                  <td className="py-3 px-4 flex gap-2">
                    <Link href={`/discounts/${d.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="text-red-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {deletingId === d.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
