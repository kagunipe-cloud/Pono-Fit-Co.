"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ScheduleGrid from "@/components/ScheduleGrid";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type MemberMe = { member_id: string; first_name?: string | null; last_name?: string | null } | null;

type AvailabilityBlock = {
  id: number;
  trainer: string;
  day_of_week: number;
  days_of_week: string | null;
  start_time: string;
  end_time: string;
  description: string | null;
};

export default function TrainerSchedulePage() {
  const router = useRouter();
  const [member, setMember] = useState<MemberMe>(null);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addDay, setAddDay] = useState(1);
  const [addStart, setAddStart] = useState("09:00");
  const [addEnd, setAddEnd] = useState("17:00");
  const [addDesc, setAddDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MemberMe) => {
        if (!data?.member_id) {
          router.replace("/login");
          return;
        }
        setMember(data);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!member) return;
    fetch("/api/trainer/availability")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AvailabilityBlock[]) => setBlocks(Array.isArray(data) ? data : []))
      .catch(() => setBlocks([]));
  }, [member]);

  async function handleAdd() {
    if (!member) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/trainer/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day_of_week: addDay, start_time: addStart, end_time: addEnd, description: addDesc || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setBlocks((prev) => [...prev, data]);
        setShowAdd(false);
        setAddDesc("");
      } else {
        alert(data.error ?? "Failed to add");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this availability block? Existing bookings will be removed.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/trainer/availability/${id}`, { method: "DELETE" });
      if (res.ok) setBlocks((prev) => prev.filter((b) => b.id !== id));
      else {
        const data = await res.json();
        alert(data.error ?? "Failed to delete");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading || !member) {
    return <div className="p-8 text-center text-stone-500">Loading…</div>;
  }

  const displayName = [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || "Trainer";

  return (
    <div>
      <p className="mb-4 text-sm text-stone-600">
        Your availability blocks and admin-blocked time. Members book PT with you from the Schedule.
      </p>
      <ScheduleGrid
        variant="trainer"
        trainerMemberId={member.member_id}
        trainerDisplayName={displayName}
      />

      <div className="mt-10 max-w-2xl">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">Recurring availability</h2>
        {blocks.length === 0 && !showAdd && (
          <p className="text-sm text-stone-500 mb-3">No recurring blocks yet. Add when you’re available for PT each week.</p>
        )}
        <ul className="space-y-2 mb-4">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg bg-white border border-stone-200">
              <span className="text-sm text-stone-700">
                {DAY_NAMES[b.day_of_week]} {b.start_time}–{b.end_time}
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
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Add availability block
          </button>
        ) : (
          <div className="p-4 rounded-xl border border-stone-200 bg-white space-y-3">
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
                    <option key={i} value={i}>{name}</option>
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
                type="button"
                onClick={handleAdd}
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
          </div>
        )}
      </div>
    </div>
  );
}
