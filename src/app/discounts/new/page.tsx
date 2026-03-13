"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewDiscountPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    percent_off: "",
    description: "",
    scope: "cart",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          percent_off: parseInt(form.percent_off, 10) || 0,
          description: form.description.trim() || null,
          scope: form.scope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      router.push("/discounts");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/discounts" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to discounts</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Add Discount</h1>
      <p className="text-stone-500 text-sm mb-6">Create a promo code. Members enter it on the cart screen.</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Code</label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200 font-mono uppercase"
            placeholder="e.g. KUKEA"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Percent off</label>
          <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
            <input
              type="number"
              min={0}
              max={100}
              value={form.percent_off}
              onChange={(e) => setForm((f) => ({ ...f, percent_off: e.target.value }))}
              className="flex-1 min-w-0 px-4 py-2.5 border-0"
              placeholder="10"
            />
            <span className="pr-4 text-stone-500">%</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Scope</label>
          <select
            value={form.scope}
            onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
          >
            <option value="cart">Entire cart</option>
            <option value="item">Per item</option>
          </select>
          <p className="text-xs text-stone-500 mt-1">Cart = percent off total. Item = percent off each line (future).</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Description (optional)</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
            placeholder="e.g. 10% off"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
            {loading ? "Creating…" : "Create discount"}
          </button>
          <Link href="/discounts" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
