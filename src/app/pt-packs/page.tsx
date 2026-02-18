"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type Pack = { id: number; name: string; duration_minutes: number; credits: number; price: string };

export default function PTPacksPage() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", duration_minutes: 60, credits: 5, price: "" });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", duration_minutes: 60, credits: 5, price: "" });
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function fetchPacks() {
    fetch("/api/offerings/pt-pack-products")
      .then((r) => r.json())
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchPacks(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.price.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/offerings/pt-pack-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ name: "", duration_minutes: 60, credits: 5, price: "" });
        fetchPacks();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (editingId == null || !editForm.name.trim() || !editForm.price.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/offerings/pt-pack-products/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingId(null);
        fetchPacks();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(packId: number) {
    if (!confirm("Delete this PT pack? This cannot be undone.")) return;
    setDeletingId(packId);
    try {
      const res = await fetch(`/api/offerings/pt-pack-products/${packId}`, { method: "DELETE" });
      if (res.ok) fetchPacks();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed");
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">PT Packs</h1>
        <p className="text-stone-500 mt-1">Sell packs of 30, 60, or 90 min PT credits. Members use credits when booking a PT slot.</p>
      </header>
      <form onSubmit={handleCreate} className="mb-8 p-6 rounded-xl border border-stone-200 bg-white space-y-4">
        <h2 className="font-semibold text-stone-800">Add PT Pack</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="e.g. 5× 60 min PT" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Duration (min)</label>
            <select value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: parseInt(e.target.value, 10) }))} className="w-full px-3 py-2 rounded-lg border border-stone-200">
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={90}>90</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Credits</label>
            <input type="number" min={1} value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: parseInt(e.target.value, 10) || 5 }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Price</label>
            <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
            <span className="pl-3 text-stone-500">$</span>
            <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-2 py-2 border-0" placeholder="0" required />
          </div>
          </div>
        </div>
        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{submitting ? "Adding…" : "Add PT pack"}</button>
      </form>
      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        {loading ? <div className="p-12 text-center text-stone-500">Loading…</div> : packs.length === 0 ? <div className="p-12 text-center text-stone-500">No PT packs yet.</div> : (
          <ul className="divide-y divide-stone-100">
            {packs.map((p) => (
              <li key={p.id} className="p-4 flex justify-between items-center flex-wrap gap-2">
                {editingId === p.id ? (
                  <form onSubmit={handleUpdate} className="flex flex-wrap items-center gap-2 flex-1">
                    <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="px-2 py-1 rounded border border-stone-200 text-sm" placeholder="Name" required />
                    <select value={editForm.duration_minutes} onChange={(e) => setEditForm((f) => ({ ...f, duration_minutes: parseInt(e.target.value, 10) }))} className="px-2 py-1 rounded border border-stone-200 text-sm">
                      <option value={30}>30 min</option>
                      <option value={60}>60 min</option>
                      <option value={90}>90 min</option>
                    </select>
                    <input type="number" min={1} value={editForm.credits} onChange={(e) => setEditForm((f) => ({ ...f, credits: parseInt(e.target.value, 10) || 5 }))} className="w-14 px-2 py-1 rounded border border-stone-200 text-sm" />
                    <div className="flex items-center w-24 rounded border border-stone-200 text-sm overflow-hidden">
                    <span className="pl-2 text-stone-500">$</span>
                    <input value={editForm.price} onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-1 py-1 border-0" placeholder="0" required />
                  </div>
                    <button type="submit" disabled={submitting} className="text-brand-600 hover:underline text-sm font-medium">Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-stone-500 hover:underline text-sm">Cancel</button>
                  </form>
                ) : (
                  <>
                    <span className="font-medium text-stone-800">{p.name}</span>
                    <span className="text-stone-600">{p.credits}×{p.duration_minutes} min · {formatPrice(p.price)}</span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => { setEditingId(p.id); setEditForm({ name: p.name, duration_minutes: p.duration_minutes, credits: p.credits, price: p.price }); }} className="text-brand-600 hover:underline text-sm font-medium">Edit</button>
                      <button type="button" onClick={() => handleDelete(p.id)} disabled={deletingId !== null} className="text-red-600 hover:underline text-sm font-medium disabled:opacity-50">Delete</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4">
        <Link href="/schedule" className="text-brand-600 hover:underline">Schedule →</Link>
      </p>
    </div>
  );
}
