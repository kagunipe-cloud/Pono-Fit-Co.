"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Trainer = { member_id: string; display_name: string };

type UnavailableBlock = {
  id: number;
  trainer: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  description: string;
  recurrence_type?: string;
  occurrence_date?: string | null;
  weeks_count?: number | null;
};

function BlockTimeContent() {
  const searchParams = useSearchParams();
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [blocks, setBlocks] = useState<UnavailableBlock[]>([]);
  const [trainer, setTrainer] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("13:00");
  const [description, setDescription] = useState("Unavailable");
  const [recurrenceType, setRecurrenceType] = useState<"one_time" | "recurring">("recurring");
  const [occurrenceDate, setOccurrenceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weeksCount, setWeeksCount] = useState<string>(""); // "" = indefinitely
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const t = searchParams.get("trainer")?.trim();
    if (t) setTrainer(t);
    const d = searchParams.get("day")?.trim();
    if (d !== null && d !== undefined) {
      const dayNum = parseInt(d, 10);
      if (dayNum >= 0 && dayNum <= 6) setDayOfWeek(dayNum);
    }
    const start = searchParams.get("start")?.trim();
    if (start) setStartTime(start);
    const end = searchParams.get("end")?.trim();
    if (end) setEndTime(end);
  }, [searchParams]);

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
    if (recurrenceType === "one_time" && !occurrenceDate) {
      alert("Please select a date for one-time blocks.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        trainer: trainer.trim(),
        start_time: startTime,
        end_time: endTime,
        description: description.trim() || "Unavailable",
        recurrence_type: recurrenceType,
      };
      if (recurrenceType === "one_time") {
        payload.occurrence_date = occurrenceDate;
      } else {
        payload.day_of_week = dayOfWeek;
        payload.occurrence_date = occurrenceDate || undefined;
        payload.weeks_count = weeksCount === "" || weeksCount === "indefinite" ? null : parseInt(weeksCount, 10);
      }
      const res = await fetch("/api/offerings/unavailable-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        loadBlocks();
        setDescription("Unavailable");
        setOccurrenceDate(new Date().toISOString().slice(0, 10));
        setWeeksCount("");
      } else {
        alert(data.error ?? "Failed to add");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this blocked-off time?")) return;
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
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Block off time</h1>
      <p className="text-sm text-stone-600 mb-6">
        Mark time slots as unavailable so they can’t be booked. Leave trainer empty for facility-wide, or select a trainer to block off only their time. Choose one-time (e.g. doctor’s appointment) or recurring with weeks.
      </p>
      <div className="flex flex-wrap gap-4 mb-6">
        <Link href="/master-schedule" className="text-brand-600 hover:underline text-sm">← Master Schedule</Link>
        <Link href="/admin/trainers/new" className="text-brand-600 hover:underline text-sm">Add trainer</Link>
      </div>

      <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-stone-200 bg-white space-y-4 mb-8">
        <h2 className="font-semibold text-stone-800">Add blocked-off time</h2>
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-2">Recurrence</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="recurrence"
                checked={recurrenceType === "one_time"}
                onChange={() => setRecurrenceType("one_time")}
                className="rounded"
              />
              <span>One-time</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="recurrence"
                checked={recurrenceType === "recurring"}
                onChange={() => setRecurrenceType("recurring")}
                className="rounded"
              />
              <span>Recurring</span>
            </label>
          </div>
        </div>
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
          {recurrenceType === "one_time" ? (
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-1">Date</label>
              <input
                type="date"
                value={occurrenceDate}
                onChange={(e) => setOccurrenceDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200"
              />
            </div>
          ) : (
            <>
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
                <label className="block text-sm font-medium text-stone-600 mb-1">Start date</label>
                <input
                  type="date"
                  value={occurrenceDate}
                  onChange={(e) => setOccurrenceDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">For how many weeks</label>
                <select
                  value={weeksCount}
                  onChange={(e) => setWeeksCount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                >
                  <option value="">Indefinitely</option>
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>{n} week{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
              </div>
            </>
          )}
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
          {submitting ? "Adding…" : "Add blocked-off time"}
        </button>
      </form>

      <h2 className="font-semibold text-stone-800 mb-3">Current blocked-off time</h2>
      {blocks.length === 0 ? (
        <p className="text-sm text-stone-500">No blocked-off time.</p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => {
            const isOneTime = (b.recurrence_type ?? "recurring").toLowerCase() === "one_time";
            const recurLabel = isOneTime
              ? (b.occurrence_date ?? "")
              : `${DAY_NAMES[b.day_of_week]}${b.weeks_count ? ` · ${b.weeks_count} wk` : " · Indef"}`;
            return (
            <li key={b.id} className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg bg-white border border-stone-200">
              <span className="text-sm text-stone-700">
                {b.trainer || "Facility"} · {recurLabel} · {b.start_time}–{b.end_time}
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
          );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AdminBlockTimePage() {
  return (
    <Suspense fallback={<div className="max-w-2xl p-8 text-stone-500">Loading…</div>}>
      <BlockTimeContent />
    </Suspense>
  );
}
