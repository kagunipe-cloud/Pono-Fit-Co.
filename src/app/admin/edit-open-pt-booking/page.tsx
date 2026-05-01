"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function EditOpenPtBookingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id")?.trim() || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    fetch(`/api/offerings/pt-open-bookings/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { occurrence_date?: string; start_time?: string } | null) => {
        if (row) {
          setDate(String(row.occurrence_date ?? ""));
          const st = String(row.start_time ?? "").trim();
          setTime(st.length >= 5 ? st.slice(0, 5) : st);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    if (!id || !date) return;
    setSaving(true);
    setError(null);
    const t = time.trim();
    const startTime = t.length === 5 ? `${t}:00` : t.length >= 8 ? t : `${normalizeTime(t)}:00`;
    try {
      const res = await fetch(`/api/offerings/pt-open-bookings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrence_date: date, start_time: startTime }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to save");
      router.push("/master-schedule");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!id) {
    return <p className="p-6 text-stone-600">Missing booking id. Open this page from the schedule.</p>;
  }
  if (loading) return <p className="p-6 text-stone-500">Loading…</p>;

  return (
    <div className="max-w-md mx-auto p-6">
      <Link href="/master-schedule" className="text-sm text-stone-500 hover:text-stone-700">
        ← Master schedule
      </Link>
      <h1 className="text-xl font-bold text-stone-800 mt-4">Reschedule open PT booking</h1>
      <p className="text-sm text-stone-600 mt-2">
        Change the date or start time. Assigned trainers may receive email if you change assignment elsewhere.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-stone-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Start time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-stone-900"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !date}
          className="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium text-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function normalizeTime(t: string): string {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = (parts[0] ?? 0) % 24;
  const m = Math.min(59, Math.max(0, parts[1] ?? 0));
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export default function EditOpenPtBookingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-stone-500">Loading…</div>}>
      <EditOpenPtBookingContent />
    </Suspense>
  );
}
