"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type ClassRow = {
  id: number;
  product_id: string;
  class_name: string | null;
  instructor: string | null;
  date: string | null;
  time: string | null;
  capacity: string | null;
  status: string | null;
  price: string | null;
  is_recurring?: number;
  days_of_week?: string | null;
};

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateWeeks, setGenerateWeeks] = useState(12);

  async function fetchClasses() {
    try {
      const res = await fetch("/api/offerings/classes");
      if (!res.ok) throw new Error("Failed to fetch");
      setClasses(await res.json());
    } catch {
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchClasses(); }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this class?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offerings/classes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchClasses();
    } catch {
      alert("Could not delete.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleGenerate(id: number) {
    setGeneratingId(id);
    try {
      const weeks = Math.min(52, Math.max(1, generateWeeks));
      const res = await fetch(`/api/offerings/classes/${id}/generate-occurrences`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weeks }) });
      const data = await res.ok ? res.json() : {};
      if (res.ok) alert(`Generated ${data.inserted ?? 0} occurrences.`);
      else alert(data.error ?? "Failed");
      await fetchClasses();
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Classes</h1>
          <p className="text-stone-500 mt-1">Class schedule. Add, edit, or delete.</p>
        </div>
        <Link href="/classes/new" className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">Add class</Link>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-stone-600">
        <span>When generating occurrences for recurring classes, use</span>
        <input type="number" min={1} max={52} value={generateWeeks} onChange={(e) => setGenerateWeeks(Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 12)))} className="w-14 px-2 py-1.5 rounded border border-stone-200" />
        <span>weeks.</span>
      </div>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : classes.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No classes yet. <Link href="/classes/new" className="text-brand-600 hover:underline">Add one</Link>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Class</th>
                <th className="py-3 px-4">Instructor</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Capacity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} className="border-t border-stone-100 hover:bg-brand-50/30">
                  <td className="py-3 px-4 font-medium text-stone-800">{c.class_name ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{c.instructor ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{c.date ?? (c.is_recurring ? "Recurring" : "—")}</td>
                  <td className="py-3 px-4 text-stone-600">{c.time ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{c.capacity ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{c.status ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{formatPrice(c.price)}</td>
                  <td className="py-3 px-4 text-stone-600">{c.is_recurring ? "Recurring" : "One-off"}</td>
                  <td className="py-3 px-4 flex gap-2 flex-wrap">
                    {c.is_recurring ? (
                      <button type="button" onClick={() => handleGenerate(c.id)} disabled={generatingId === c.id} className="text-brand-600 hover:underline text-sm disabled:opacity-50">{generatingId === c.id ? "…" : `Generate ${generateWeeks} wk`}</button>
                    ) : null}
                    <Link href={`/classes/${c.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    <button type="button" onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="text-red-600 hover:underline text-sm disabled:opacity-50">{deletingId === c.id ? "…" : "Delete"}</button>
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
