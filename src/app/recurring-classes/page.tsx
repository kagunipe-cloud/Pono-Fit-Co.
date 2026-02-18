"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RecurringClass = { id: number; name: string; instructor: string | null; days_of_week: string; time: string; capacity: number };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDays(daysOfWeek: string): string {
  return daysOfWeek.split(",").map((d) => DAY_NAMES[parseInt(d.trim(), 10)] ?? "?").join(", ");
}

export default function RecurringClassesPage() {
  const [list, setList] = useState<RecurringClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateWeeks, setGenerateWeeks] = useState(12);
  const [form, setForm] = useState({ name: "", instructor: "", days_of_week: "2,4", time: "18:00", capacity: 20 });
  const [submitting, setSubmitting] = useState(false);

  function fetchList() {
    fetch("/api/offerings/recurring-classes")
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchList(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/offerings/recurring-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ name: "", instructor: "", days_of_week: "2,4", time: "18:00", capacity: 20 });
        fetchList();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerate(id: number) {
    setGeneratingId(id);
    try {
      const weeks = Math.min(52, Math.max(1, generateWeeks));
      await fetch(`/api/offerings/recurring-classes/${id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weeks }) });
      fetchList();
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this recurring class and all its occurrences and bookings?")) return;
    await fetch(`/api/offerings/recurring-classes/${id}`, { method: "DELETE" });
    fetchList();
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Recurring Classes</h1>
        <p className="text-stone-500 mt-1">Define classes that repeat weekly (e.g. Tue & Thu 6pm). Generate occurrences so members can book.</p>
      </header>

      <form onSubmit={handleCreate} className="mb-8 p-6 rounded-xl border border-stone-200 bg-white space-y-4">
        <h2 className="font-semibold text-stone-800">Add Recurring Class</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="e.g. Yoga" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Instructor</label>
            <input value={form.instructor} onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Days (comma: 0=Sun, 2=Tue, 4=Thu)</label>
            <input value={form.days_of_week} onChange={(e) => setForm((f) => ({ ...f, days_of_week: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="2,4" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Time</label>
            <input value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="18:00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Capacity</label>
            <input type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: parseInt(e.target.value, 10) || 20 }))} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
          </div>
        </div>
        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{submitting ? "Adding…" : "Add recurring class"}</button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-stone-600">
        <span>Weeks to generate:</span>
        <input type="number" min={1} max={52} value={generateWeeks} onChange={(e) => setGenerateWeeks(Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 12)))} className="w-14 px-2 py-1.5 rounded border border-stone-200" />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-12 text-center text-stone-500">No recurring classes yet. Add one above.</div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {list.map((r) => (
              <li key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-800">{r.name}</p>
                  <p className="text-sm text-stone-500">{r.instructor || "—"} · {formatDays(r.days_of_week)} at {r.time} · cap {r.capacity}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleGenerate(r.id)} disabled={generatingId === r.id} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">{generatingId === r.id ? "Generating…" : `Generate ${generateWeeks} weeks`}</button>
                  <Link href={`/schedule?recurring=${r.id}`} className="px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-sm font-medium">Schedule</Link>
                  <button type="button" onClick={() => handleDelete(r.id)} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4">
        <Link href="/schedule" className="text-brand-600 hover:underline">View full schedule & rosters →</Link>
      </p>
    </div>
  );
}
