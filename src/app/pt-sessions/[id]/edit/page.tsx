"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function EditPTSessionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    session_name: "",
    session_duration: "",
    date_time: "",
    price: "",
    trainer: "",
    category: "PT",
    description: "",
    duration_minutes: 60,
    image_url: "",
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/offerings/pt-sessions/${id}`)
      .then((res) => { if (!res.ok) throw new Error("Not found"); return res.json(); })
      .then((data) => {
        if (!cancelled) setForm({
          session_name: String(data.session_name ?? ""),
          session_duration: String(data.session_duration ?? ""),
          date_time: String(data.date_time ?? ""),
          price: String(data.price ?? ""),
          trainer: String(data.trainer ?? ""),
          category: String(data.category ?? "PT"),
          description: String(data.description ?? ""),
          duration_minutes: [30, 60, 90].includes(Number(data.duration_minutes)) ? Number(data.duration_minutes) : 60,
          image_url: String(data.image_url ?? ""),
        });
      })
      .catch(() => { if (!cancelled) setLoadErr("Not found"); });
    return () => { cancelled = true; };
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`/api/offerings/pt-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, session_duration: form.duration_minutes + " min" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      router.push("/pt-sessions");
      router.refresh();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (loadErr) return <div className="p-12 text-center text-red-600">{loadErr}. <Link href="/pt-sessions" className="underline">Back</Link></div>;

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/pt-sessions" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to PT sessions</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Edit PT Session</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {submitErr && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{submitErr}</div>}
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
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Date / time</label>
          <input type="text" value={form.date_time} onChange={(e) => setForm((f) => ({ ...f, date_time: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg border border-stone-200" placeholder="Leave blank for bookable session type" />
          <p className="text-xs text-stone-500 mt-1">Leave blank to keep this as a bookable session type (members can book it into any slot). Only set a date/time for a one-off scheduled instance.</p>
        </div>
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
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Image URL</label>
          <input type="url" value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" className="w-full px-4 py-2.5 rounded-lg border border-stone-200" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{loading ? "Saving…" : "Save"}</button>
          <Link href="/pt-sessions" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
