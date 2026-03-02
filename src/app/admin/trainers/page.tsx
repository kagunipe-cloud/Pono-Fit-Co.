"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScheduleGrid from "@/components/ScheduleGrid";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Trainer = { member_id: string; display_name: string };

type AvailabilityBlock = {
  id: number;
  trainer: string;
  trainer_member_id: string | null;
  day_of_week: number;
  days_of_week: string | null;
  start_time: string;
  end_time: string;
  description: string | null;
};

export default function AdminTrainersPage() {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>([]);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [addDay, setAddDay] = useState(1);
  const [addStart, setAddStart] = useState("09:00");
  const [addEnd, setAddEnd] = useState("17:00");
  const [addDesc, setAddDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Trainer[]) => {
        const list = Array.isArray(data) ? data : [];
        setTrainers(list);
        if (list.length > 0 && !selectedId) {
          setSelectedId(list[0].member_id);
        }
      })
      .catch(() => setTrainers([]))
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setAvailabilityBlocks([]);
      return;
    }
    fetch(`/api/offerings/trainer-availability?trainer_member_id=${encodeURIComponent(selectedId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AvailabilityBlock[]) => setAvailabilityBlocks(Array.isArray(data) ? data : []))
      .catch(() => setAvailabilityBlocks([]));
  }, [selectedId]);

  const selected = trainers.find((t) => t.member_id === selectedId) || null;

  async function handleAddAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/trainer-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer_member_id: selectedId,
          day_of_week: addDay,
          start_time: addStart,
          end_time: addEnd,
          description: addDesc.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAvailabilityBlocks((prev) => [...prev, data]);
        setScheduleRefreshKey((k) => k + 1);
        setShowAdd(false);
        setAddDesc("");
      } else {
        alert(data.error ?? "Failed to add");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAvailability(id: number) {
    if (!confirm("Remove this availability block? Existing PT bookings in this block will be removed.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/trainer/availability/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAvailabilityBlocks((prev) => prev.filter((b) => b.id !== id));
        setScheduleRefreshKey((k) => k + 1);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to delete");
      }
    } finally {
      setDeletingId(null);
    }
  }

  function formatDays(days_of_week: string | null, day_of_week: number): string {
    if (days_of_week && days_of_week.trim()) {
      return days_of_week
        .split(",")
        .map((d) => DAY_NAMES[parseInt(d.trim(), 10)] ?? "?")
        .join(", ");
    }
    return DAY_NAMES[day_of_week] ?? "?";
  }

  function handleAddAvailabilityForSlot(dayOfWeek: number, startTime: string, endTime: string) {
    setAddDay(dayOfWeek);
    setAddStart(startTime);
    setAddEnd(endTime);
    setShowAdd(true);
    setTimeout(() => document.getElementById("add-availability")?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function handleAvailabilityChange() {
    if (!selectedId) return;
    fetch(`/api/offerings/trainer-availability?trainer_member_id=${encodeURIComponent(selectedId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AvailabilityBlock[]) => setAvailabilityBlocks(Array.isArray(data) ? data : []))
      .catch(() => setAvailabilityBlocks([]));
    setScheduleRefreshKey((k) => k + 1);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Trainers</h1>
          <p className="text-sm text-stone-600">
            Add trainers and view their schedules. Trainers manage their own availability from My schedule; admins can also adjust it here.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/trainers/new"
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Add trainer
          </Link>
          <Link
            href="/master-schedule"
            className="px-4 py-2.5 rounded-lg border border-stone-200 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Master Schedule
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="p-8 text-stone-500">Loading…</div>
      ) : trainers.length === 0 ? (
        <p className="text-stone-500 text-sm">
          No trainers yet.{" "}
          <Link href="/admin/trainers/new" className="text-brand-600 hover:underline">
            Add your first trainer
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[260px,minmax(0,1fr)] gap-6">
          <aside className="bg-white border border-stone-200 rounded-xl p-3">
            <ul className="space-y-1">
              {trainers.map((t) => (
                <li key={t.member_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.member_id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                      selectedId === t.member_id
                        ? "bg-brand-50 text-brand-800"
                        : "text-stone-700 hover:bg-stone-100"
                    }`}
                  >
                    <span className="block truncate">{t.display_name}</span>
                    <span className="block text-xs text-stone-400 truncate">ID: {t.member_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="space-y-4">
            {selected ? (
              <>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <h2 className="text-lg font-semibold text-stone-800 mb-1">{selected.display_name}</h2>
                  <p className="text-xs text-stone-500">Member ID: {selected.member_id}</p>
                  <p className="mt-2 text-xs text-stone-500">
                    Trainers see and edit their own availability from <span className="font-semibold">My schedule</span>. Admins can
                    also adjust availability using the schedule below.
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <ScheduleGrid
                    variant="trainer"
                    trainerMemberId={selected.member_id}
                    trainerDisplayName={selected.display_name}
                    allowAdminEdit
                    scheduleRefreshKey={scheduleRefreshKey}
                    onAddAvailabilityForSlot={handleAddAvailabilityForSlot}
                    onAvailabilityChange={handleAvailabilityChange}
                  />
                </div>
                <div id="add-availability" className="bg-white border border-stone-200 rounded-xl p-4">
                  <h2 className="text-lg font-semibold text-stone-800 mb-3">Recurring availability</h2>
                  <p className="text-sm text-stone-500 mb-3">
                    Add or remove when this trainer is available for PT each week. This controls which slots appear as bookable on the schedule.
                  </p>
                  {availabilityBlocks.length === 0 && !showAdd && (
                    <p className="text-sm text-stone-500 mb-3">No recurring blocks yet.</p>
                  )}
                  <ul className="space-y-2 mb-4">
                    {availabilityBlocks.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg bg-stone-50 border border-stone-200">
                        <span className="text-sm text-stone-700">
                          {formatDays(b.days_of_week, b.day_of_week)} {b.start_time}–{b.end_time}
                          {b.description ? ` · ${b.description}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAvailability(b.id)}
                          disabled={deletingId === b.id}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deletingId === b.id ? "Removing…" : "Remove"}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!showAdd ? (
                    <button
                      type="button"
                      onClick={() => setShowAdd(true)}
                      className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
                    >
                      Add availability block
                    </button>
                  ) : (
                    <form onSubmit={handleAddAvailability} className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
                      <h3 className="font-medium text-stone-800">New block</h3>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1">Day</label>
                          <select
                            value={addDay}
                            onChange={(e) => setAddDay(parseInt(e.target.value, 10))}
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm"
                          >
                            {DAY_NAMES.map((name, i) => (
                              <option key={i} value={i}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1">Start</label>
                          <input
                            type="time"
                            value={addStart}
                            onChange={(e) => setAddStart(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1">End</label>
                          <input
                            type="time"
                            value={addEnd}
                            onChange={(e) => setAddEnd(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1">Description (optional)</label>
                          <input
                            type="text"
                            value={addDesc}
                            onChange={(e) => setAddDesc(e.target.value)}
                            placeholder="e.g. Main floor"
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[120px]"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                        >
                          {submitting ? "Adding…" : "Add"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAdd(false)}
                          className="px-4 py-2 rounded-lg border border-stone-200 text-sm text-stone-700 hover:bg-stone-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-stone-500 bg-white border border-stone-200 rounded-xl">
                Select a trainer on the left to view their schedule.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}


