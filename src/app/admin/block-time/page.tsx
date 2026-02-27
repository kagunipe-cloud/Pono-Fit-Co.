"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Trainer = { member_id: string; display_name: string };

type UnavailableBlock = {
  id: number;
  trainer: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  description: string;
};

export default function AdminBlockTimePage() {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [blocks, setBlocks] = useState<UnavailableBlock[]>([]);
  const [trainer, setTrainer] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("13:00");
  const [description, setDescription] = useState("Unavailable");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function loadBlocks() {
    fetch("/api/offerings/unavailable-blocks")
      .then((r) => r.json())
      .then((data: UnavailableBlock[]) => setBlocks(Array.isArray(data) ? data : []))
      .catch(() => setBlocks([]));
  }

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => r.json())
      .then((data: Trainer[]) => setTrainers(Array.isArray(data) ? data : []))
      .catch(() => setTrainers([]));
    loadBlocks();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/offerings/unavailable-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer: trainer.trim(),
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
          description: description.trim() || "Unavailable",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        loadBlocks();
        setDescription("Unavailable");
      } else {
        alert(data.error ?? "Failed to add");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this block?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offerings/unavailable-blocks/${id}`, { method: "DELETE" });
      if (res.ok) loadBlocks();
      else {
        const data = await res.json();
        alert(data.error ?? "Failed to delete");
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Block time</h1>
      <p className="text-sm text-stone-600 mb-6">
        Block off time on the schedule so it can’t be booked. Leave trainer empty for facility-wide, or select a trainer to block only their time.
      </p>
      <div className="flex flex-wrap gap-4 mb-6">
        <Link href="/master-schedule" className="text-brand-600 hover:underline text-sm">← Master Schedule</Link>
        <Link href="/admin/trainers/new" className="text-brand-600 hover:underline text-sm">Add trainer</Link>
      </div>

      <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-stone-200 bg-white space-y-4 mb-8">
        <h2 className="font-semibold text-stone-800">Add blocked time</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Trainer (optional)</label>
            <select
              value={trainer}
              onChange={(e) => setTrainer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            >
              <option value="">Facility-wide</option>
              {trainers.map((t) => (
                <option key={t.member_id} value={t.display_name}>{t.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Day</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            >
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Start</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">End</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Meeting"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add blocked time"}
        </button>
      </form>

      <h2 className="font-semibold text-stone-800 mb-3">Current blocks</h2>
      {blocks.length === 0 ? (
        <p className="text-sm text-stone-500">No blocked time.</p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg bg-white border border-stone-200">
              <span className="text-sm text-stone-700">
                {b.trainer || "Facility"} · {DAY_NAMES[b.day_of_week]} {b.start_time}–{b.end_time}
                {b.description ? ` · ${b.description}` : ""}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(b.id)}
                disabled={deletingId === b.id}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {deletingId === b.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
