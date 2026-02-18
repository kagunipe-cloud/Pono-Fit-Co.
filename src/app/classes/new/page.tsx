"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewClassPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    class_name: "",
    instructor: "",
    date: "",
    time: "",
    capacity: "",
    status: "Open",
    price: "",
    category: "Classes",
    description: "",
    image_url: "",
    is_recurring: false,
    days_of_week: "2,4",
    duration_minutes: 60,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/offerings/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, is_recurring: form.is_recurring ? 1 : 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      router.push("/classes");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/classes" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to classes</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Add Class</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Class name</label>
          <input type="text" value={form.class_name} onChange={(e) => setForm((f) => ({ ...f, class_name: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Instructor</label>
          <input type="text" value={form.instructor} onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Duration (min)</label>
          <select value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: parseInt(e.target.value, 10) }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200">
            <option value={30}>30</option>
            <option value={45}>45</option>
            <option value={60}>60</option>
            <option value={75}>75</option>
            <option value={90}>90</option>
            <option value={120}>120</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} className="rounded border-stone-300 text-brand-600" />
            <span className="text-sm font-medium text-stone-700">Recurring (e.g. every Tue & Thu)</span>
          </label>
        </div>
        {form.is_recurring ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Days of week (0=Sun…6=Sat, comma)</label>
              <input type="text" placeholder="2,4" value={form.days_of_week} onChange={(e) => setForm((f) => ({ ...f, days_of_week: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Time</label>
              <input type="text" placeholder="18:00" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Date</label>
              <input type="text" placeholder="e.g. 1/14/2026" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Time</label>
              <input type="text" placeholder="e.g. 18:30:00" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Capacity</label>
            <input type="text" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200">
              <option value="Open">Open</option>
              <option value="Full">Full</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Price</label>
          <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
              <span className="pl-4 text-stone-500">$</span>
              <input type="text" placeholder="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-3 py-2.5 border-0" />
            </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Photo (image URL)</label>
          <input type="url" value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{loading ? "Creating…" : "Create"}</button>
          <Link href="/classes" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
