"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function EditDiscountPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    percent_off: "",
    description: "",
    scope: "cart",
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchDiscount() {
      try {
        const res = await fetch(`/api/admin/discounts/${id}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        if (!cancelled) {
          setForm({
            code: String(data.code ?? ""),
            percent_off: String(data.percent_off ?? ""),
            description: String(data.description ?? ""),
            scope: String(data.scope ?? "cart"),
          });
        }
      } catch {
        if (!cancelled) setLoadErr("Discount not found");
      }
    }
    fetchDiscount();
    return () => { cancelled = true; };
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`/api/admin/discounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          percent_off: parseInt(form.percent_off, 10),
          description: form.description.trim() || null,
          scope: form.scope,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update");
      router.push("/discounts");
      router.refresh();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (loadErr) return <div className="p-12 text-center text-red-600">{loadErr}. <Link href="/discounts" className="underline">Back to discounts</Link></div>;

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/discounts" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to discounts</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Edit Discount</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {submitErr && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{submitErr}</div>}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Code</label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200 font-mono uppercase"
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
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Description (optional)</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
            {loading ? "Saving…" : "Save"}
          </button>
          <Link href="/discounts" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
