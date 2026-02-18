"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function EditMembershipPlanPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    plan_name: "",
    price: "",
    length: "",
    unit: "Month",
    access_level: "",
    category: "Plans",
    description: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchPlan() {
      try {
        const res = await fetch(`/api/offerings/membership-plans/${id}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        if (!cancelled) {
          setForm({
            plan_name: String(data.plan_name ?? ""),
            price: String(data.price ?? ""),
            length: String(data.length ?? ""),
            unit: String(data.unit ?? "Month"),
            access_level: String(data.access_level ?? ""),
            category: String(data.category ?? "Plans"),
            description: String(data.description ?? ""),
          });
        }
      } catch {
        if (!cancelled) setLoadErr("Plan not found");
      }
    }
    fetchPlan();
    return () => { cancelled = true; };
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`/api/offerings/membership-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update");
      router.push("/membership-plans");
      router.refresh();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (loadErr) return <div className="p-12 text-center text-red-600">{loadErr}. <Link href="/membership-plans" className="underline">Back to plans</Link></div>;

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/membership-plans" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to plans</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Edit Membership Plan</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {submitErr && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{submitErr}</div>}
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
            <label className="block text-sm font-medium text-stone-700 mb-1">Length</label>
            <input type="text" value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
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
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{loading ? "Saving…" : "Save"}</button>
          <Link href="/membership-plans" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
