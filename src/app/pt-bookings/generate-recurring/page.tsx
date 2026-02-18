"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Member = { member_id: string; first_name: string | null; last_name: string | null };
type SessionType = { id: number; session_name: string; duration_minutes: number; price: string; trainer: string | null };

export default function GenerateRecurringPTBookingPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    useMember: true,
    member_id: "",
    guest_name: "",
    pt_session_id: "",
    day_of_week: 1,
    time: "09:00",
    weeks: 12,
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/members").then((r) => r.json()),
      fetch("/api/offerings/pt-session-products").then((r) => r.json()),
    ])
      .then(([memData, sessData]) => {
        setMembers(Array.isArray(memData) ? memData : []);
        setSessionTypes(Array.isArray(sessData) ? sessData : []);
        if (Array.isArray(memData) && memData.length > 0 && !form.member_id) {
          setForm((f) => ({ ...f, member_id: memData[0].member_id ?? "" }));
        }
        if (Array.isArray(sessData) && sessData.length > 0 && !form.pt_session_id) {
          setForm((f) => ({ ...f, pt_session_id: String(sessData[0].id) }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/offerings/pt-open-bookings/generate-recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: form.useMember ? form.member_id : "",
          guest_name: form.useMember ? "" : form.guest_name.trim(),
          pt_session_id: parseInt(form.pt_session_id, 10),
          day_of_week: form.day_of_week,
          time: form.time,
          weeks: Math.min(52, Math.max(1, form.weeks)),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(`Created ${data.inserted ?? 0} recurring PT bookings (out of ${data.total ?? 0} possible dates; some may have been skipped if the slot was already taken).`);
      } else {
        setError(data.error ?? "Failed to generate.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link href="/pt-bookings" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to PT Bookings</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Generate Recurring PT Session Booking</h1>
      <p className="text-stone-600 text-sm mb-6">Create standing appointments at the same day and time every week. Use a member in the system (credits will be docked when the session passes) or type a name for a guest not yet in the system.</p>

      {sessionTypes.length === 0 && (
        <p className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
          No bookable PT session types. Add a PT session with no date/time on the{" "}
          <Link href="/pt-sessions" className="underline">PT Sessions</Link> page first.
        </p>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        {result && <div className="p-3 rounded-lg bg-green-50 text-green-800 text-sm">{result}</div>}

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Who</label>
          <div className="flex gap-4 flex-wrap mb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="who" checked={form.useMember} onChange={() => setForm((f) => ({ ...f, useMember: true, guest_name: "" }))} className="text-brand-600" />
              <span>Member in system</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="who" checked={!form.useMember} onChange={() => setForm((f) => ({ ...f, useMember: false, member_id: "" }))} className="text-brand-600" />
              <span>Type name (guest / not in system)</span>
            </label>
          </div>
          {form.useMember ? (
            <select
              value={form.member_id}
              onChange={(e) => setForm((f) => ({ ...f, member_id: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
              required={form.useMember}
            >
              <option value="">Select member</option>
              {members.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {[m.first_name, m.last_name].filter(Boolean).join(" ") || m.member_id}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={form.guest_name}
              onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
              placeholder="e.g. Jane Smith"
              required={!form.useMember}
            />
          )}
          {!form.useMember && <p className="text-xs text-stone-500 mt-1">Credits are not docked for guests. Use when the person isn’t in the system yet.</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Session type</label>
          <select
            value={form.pt_session_id}
            onChange={(e) => setForm((f) => ({ ...f, pt_session_id: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
            required
          >
            <option value="">Select session type</option>
            {sessionTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.session_name} ({s.duration_minutes} min)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Day of week</label>
          <select
            value={form.day_of_week}
            onChange={(e) => setForm((f) => ({ ...f, day_of_week: parseInt(e.target.value, 10) }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
          >
            {DAY_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Time</label>
          <input
            type="text"
            value={form.time}
            onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
            placeholder="09:00"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Weeks</label>
          <input
            type="number"
            min={1}
            max={52}
            value={form.weeks}
            onChange={(e) => setForm((f) => ({ ...f, weeks: Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 12)) }))}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || sessionTypes.length === 0 || (form.useMember ? !form.member_id : !form.guest_name.trim())}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Generating…" : "Generate recurring bookings"}
          </button>
          <Link href="/pt-bookings" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
