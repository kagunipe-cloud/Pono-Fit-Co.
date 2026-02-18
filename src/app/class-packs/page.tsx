"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type Pack = { id: number; name: string; credits: number; price: string };

export default function ClassPacksPage() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", credits: 10, price: "" });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", credits: 10, price: "" });
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function fetchPacks() {
    fetch("/api/offerings/class-packs")
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
      const res = await fetch("/api/offerings/class-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, credits: form.credits, price: form.price }),
      });
      if (res.ok) {
        setForm({ name: "", credits: 10, price: "" });
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
      const res = await fetch(`/api/offerings/class-packs/${editingId}`, {
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
    if (!confirm("Delete this class pack? This cannot be undone.")) return;
    setDeletingId(packId);
    try {
      const res = await fetch(`/api/offerings/class-packs/${packId}`, { method: "DELETE" });
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
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Class Packs</h1>
        <p className="text-stone-500 mt-1">Sell packs of class credits (e.g. 10 classes). Members use credits to book recurring classes.</p>
      </header>
      <form onSubmit={handleCreate} className="mb-8 p-6 rounded-xl border border-stone-200 bg-white space-y-4">
        <h2 className="font-semibold text-stone-800">Add Class Pack</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="e.g. 10 class pack" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Credits</label>
            <input type="number" min={1} value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: parseInt(e.target.value, 10) || 10 }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Price</label>
            <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
              <span className="pl-3 text-stone-500">$</span>
              <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-2 py-2 border-0" placeholder="0" required />
            </div>
          </div>
        </div>
        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{submitting ? "Adding…" : "Add class pack"}</button>
      </form>
      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        {loading ? <div className="p-12 text-center text-stone-500">Loading…</div> : packs.length === 0 ? <div className="p-12 text-center text-stone-500">No class packs yet.</div> : (
          <ul className="divide-y divide-stone-100">
            {packs.map((p) => (
              <li key={p.id} className="p-4 flex justify-between items-center flex-wrap gap-2">
                {editingId === p.id ? (
                  <form onSubmit={handleUpdate} className="flex flex-wrap items-center gap-2 flex-1">
                    <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="px-2 py-1 rounded border border-stone-200 text-sm" placeholder="Name" required />
                    <input type="number" min={1} value={editForm.credits} onChange={(e) => setEditForm((f) => ({ ...f, credits: parseInt(e.target.value, 10) || 10 }))} className="w-16 px-2 py-1 rounded border border-stone-200 text-sm" />
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
                    <span className="text-stone-600">{p.credits} credits · {formatPrice(p.price)}</span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => { setEditingId(p.id); setEditForm({ name: p.name, credits: p.credits, price: p.price }); }} className="text-brand-600 hover:underline text-sm font-medium">Edit</button>
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
        <Link href="/members" className="text-brand-600 hover:underline">Add pack to member cart →</Link>
      </p>
    </div>
  );
}
