"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "Pacific/Auckland",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
];

export default function AdminSettingsPage() {
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { timezone?: string } | null) => {
        if (data?.timezone) setTimezone(data.timezone);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!timezone.trim()) {
      setMessage({ type: "err", text: "Select or enter a timezone." });
      return;
    }
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: timezone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Failed to save." });
        return;
      }
      setMessage({ type: "ok", text: "Settings saved. Schedules, macros, and usage will use this timezone." });
    } catch {
      setMessage({ type: "err", text: "Something went wrong." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Settings</h1>
        <p className="text-stone-500 mt-1">
          Manage databases, backup, and more.
        </p>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link
          href="/exercises"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Exercise database</h2>
          <p className="text-sm text-stone-500 mt-0.5">Add and edit exercises for workouts.</p>
        </Link>
        <Link
          href="/macros"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Macros database</h2>
          <p className="text-sm text-stone-500 mt-0.5">Manage macro templates and food entries.</p>
        </Link>
        <Link
          href="/admin/backup"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Backup & Restore</h2>
          <p className="text-sm text-stone-500 mt-0.5">Download a backup or restore from file.</p>
        </Link>
        <Link
          href="/admin/import-members"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Import members</h2>
          <p className="text-sm text-stone-500 mt-0.5">Import members from a CSV file.</p>
        </Link>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">General</h2>
        <p className="text-stone-500 mb-4">
          Gym timezone for schedules, macros, usage, and journal dates.
        </p>
      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Timezone</label>
            <select
              value={COMMON_TIMEZONES.includes(timezone) ? timezone : ""}
              onChange={(e) => setTimezone(e.target.value || timezone)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            >
              <option value="">Custom (enter below)</option>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              Or type any IANA timezone (e.g. America/New_York) in the box and save.
            </p>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. America/Chicago"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {message && (
            <p className={`text-sm ${message.type === "ok" ? "text-green-700" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
        </form>
      )}
      </section>
    </div>
  );
}
