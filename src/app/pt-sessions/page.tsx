"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type Session = {
  id: number;
  product_id: string;
  session_name: string | null;
  session_duration: string | null;
  date_time: string | null;
  price: string | null;
  trainer: string | null;
  category: string | null;
};

export default function PTSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function fetchSessions() {
    try {
      const res = await fetch("/api/offerings/pt-sessions");
      if (!res.ok) throw new Error("Failed to fetch");
      setSessions(await res.json());
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSessions(); }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this PT session?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offerings/pt-sessions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchSessions();
    } catch {
      alert("Could not delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">PT Sessions</h1>
          <p className="text-stone-500 mt-1">Session types (templates). Add types with no date/time so members can book them into any slot.</p>
        </div>
        <Link href="/pt-sessions/new" className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">Add PT session</Link>
      </header>

      <p className="mb-6 text-sm text-stone-600">
        To create standing appointments (recurring bookings), use{" "}
        <Link href="/pt-bookings/generate-recurring" className="text-brand-600 hover:underline font-medium">Generate Recurring PT Session Booking</Link>
        {" "}— those are stored under PT Bookings.
      </p>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No PT sessions yet. <Link href="/pt-sessions/new" className="text-brand-600 hover:underline">Add one</Link>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Session</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Date / time</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Trainer</th>
                <th className="py-3 px-4 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-stone-100 hover:bg-brand-50/30">
                  <td className="py-3 px-4 font-medium text-stone-800">{s.session_name ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{s.session_duration ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{s.date_time ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{formatPrice(s.price)}</td>
                  <td className="py-3 px-4 text-stone-600">{s.trainer ?? "—"}</td>
                  <td className="py-3 px-4 flex gap-2">
                    <Link href={`/pt-sessions/${s.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    <button type="button" onClick={() => handleDelete(s.id)} disabled={deletingId === s.id} className="text-red-600 hover:underline text-sm disabled:opacity-50">{deletingId === s.id ? "…" : "Delete"}</button>
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
