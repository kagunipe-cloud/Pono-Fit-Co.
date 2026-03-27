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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12 am" : i < 12 ? `${i} am` : i === 12 ? "12 pm" : `${i - 12} pm`,
}));

export default function AdminSettingsPage() {
  const [timezone, setTimezone] = useState("");
  const [openHourMin, setOpenHourMin] = useState(6);
  const [openHourMax, setOpenHourMax] = useState(22);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { timezone?: string; open_hour_min?: number; open_hour_max?: number } | null) => {
        if (data?.timezone) setTimezone(data.timezone);
        if (typeof data?.open_hour_min === "number") setOpenHourMin(data.open_hour_min);
        if (typeof data?.open_hour_max === "number") setOpenHourMax(data.open_hour_max);
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
    if (openHourMin > openHourMax) {
      setMessage({ type: "err", text: "Open time must be before close time." });
      return;
    }
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: timezone.trim(),
          open_hour_min: openHourMin,
          open_hour_max: openHourMax,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Failed to save." });
        return;
      }
      setMessage({ type: "ok", text: "Settings saved. Schedules and analytics will use this timezone and open hours." });
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
          <p className="text-sm text-stone-500 mt-0.5">Import members from a Glofox-style CSV file.</p>
        </Link>
        <Link
          href="/discounts"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Discounts</h2>
          <p className="text-sm text-stone-500 mt-0.5">Manage promo codes for cart and checkout.</p>
        </Link>
        <Link
          href="/admin/settings/emails-documents"
          className="block p-4 rounded-xl border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
        >
          <h2 className="font-semibold text-stone-800">Emails & Documents</h2>
          <p className="text-sm text-stone-500 mt-0.5">Edit auto-sent emails and waiver documents (privacy, terms, gym).</p>
        </Link>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">General</h2>
        <p className="text-stone-500 mb-4">
          Timezone and open hours set defaults for schedules and analytics.
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
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Open hours</label>
            <p className="text-xs text-stone-500 mb-2">
              Default time range for schedules and occupancy analytics.
            </p>
            <div className="flex items-center gap-3">
              <div>
                <label htmlFor="open-min" className="sr-only">Open</label>
                <select
                  id="open-min"
                  value={openHourMin}
                  onChange={(e) => setOpenHourMin(parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200"
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <span className="text-stone-500">to</span>
              <div>
                <label htmlFor="open-max" className="sr-only">Close</label>
                <select
                  id="open-max"
                  value={openHourMax}
                  onChange={(e) => setOpenHourMax(parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200"
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
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
