"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewMembershipPlanPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    plan_name: "",
    price: "",
    length: "",
    unit: "Month",
    access_level: "",
    category: "Plans",
    description: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/offerings/membership-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      router.push("/membership-plans");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/membership-plans" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to plans</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Add Membership Plan</h1>
      <p className="text-stone-500 text-sm mb-6">Duration is length + unit (e.g. 1 Month, 7 Day).</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Plan name</label>
          <input type="text" value={form.plan_name} onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Price</label>
          <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
          <span className="pl-4 text-stone-500">$</span>
          <input type="text" placeholder="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-3 py-2.5 border-0" />
        </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Length (duration)</label>
            <input type="text" placeholder="e.g. 1 or 7" value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Unit</label>
            <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200">
              <option value="Day">Day</option>
              <option value="Month">Month</option>
              <option value="Year">Year</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
            {loading ? "Creating…" : "Create plan"}
          </button>
          <Link href="/membership-plans" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
