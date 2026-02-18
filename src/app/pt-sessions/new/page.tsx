"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewPTSessionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    session_name: "",
    session_duration: "60",
    price: "",
    trainer: "",
    category: "PT",
    description: "",
    duration_minutes: 60,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/offerings/pt-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, session_duration: form.duration_minutes + " min" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      router.push("/pt-sessions");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/pt-sessions" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to PT sessions</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Add PT Session</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Session name</label>
          <input type="text" value={form.session_name} onChange={(e) => setForm((f) => ({ ...f, session_name: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Duration (min)</label>
          <select value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: parseInt(e.target.value, 10), session_duration: e.target.value + " min" }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200">
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
          </select>
        </div>
        <p className="text-sm text-stone-500">No date/time — this session can be booked into any available slot on the schedule.</p>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Price</label>
          <div className="flex items-center rounded-lg border border-stone-200 bg-white overflow-hidden">
          <span className="pl-4 text-stone-500">$</span>
          <input type="text" placeholder="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="flex-1 min-w-0 px-3 py-2.5 border-0" />
        </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Trainer</label>
          <input type="text" value={form.trainer} onChange={(e) => setForm((f) => ({ ...f, trainer: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{loading ? "Creating…" : "Create"}</button>
          <Link href="/pt-sessions" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
