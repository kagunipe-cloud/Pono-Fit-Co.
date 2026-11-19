"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProgramCalendarBoard, { type ProgramWorkoutRow } from "@/components/trainer/ProgramCalendarBoard";
import { TRAINING_PHASES } from "@/lib/training-programs";

export default function TrainerProgramEditPage() {
  const params = useParams();
  const programId = params.id as string;
  const [title, setTitle] = useState("");
  const [workouts, setWorkouts] = useState<ProgramWorkoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [dupFrom, setDupFrom] = useState("1");
  const [dupTo, setDupTo] = useState("1");
  const [dupTarget, setDupTarget] = useState("8");
  const [dupCopies, setDupCopies] = useState("1");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/trainer/programs/${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setTitle(d.program?.title ?? "");
        setWorkouts(Array.isArray(d.workouts) ? d.workouts : []);
      })
      .finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addWorkout() {
    const name = window.prompt("Workout name", "Day workout");
    if (!name?.trim()) return;
    const dayStr = window.prompt("Day index (1 = first day)", "1");
    const day_index = Math.max(1, parseInt(dayStr ?? "1", 10) || 1);
    const phase = (window.prompt(`Phase (${TRAINING_PHASES.join("/")})`, "HYPERTROPHY") ?? "HYPERTROPHY").toUpperCase();
    await fetch(`/api/trainer/programs/${programId}/workouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), day_index, training_phase: phase, exercises: [] }),
    });
    load();
  }

  async function moveWorkout(workoutId: number, newDayIndex: number) {
    await fetch(`/api/trainer/programs/${programId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workouts: [{ id: workoutId, day_index: newDayIndex }] }),
    });
    load();
  }

  async function duplicateBlock() {
    await fetch(`/api/trainer/programs/${programId}/duplicate-block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_day_start: parseInt(dupFrom, 10),
        from_day_end: parseInt(dupTo, 10),
        to_day_start: parseInt(dupTarget, 10),
        copies: parseInt(dupCopies, 10) || 1,
      }),
    });
    load();
  }

  async function assignClient() {
    setAssignMsg(null);
    const res = await fetch(`/api/trainer/programs/${programId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_member_id: clientId.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setAssignMsg(res.ok ? "Program sent to client." : (data.error ?? "Assign failed"));
  }

  async function togglePublished() {
    await fetch(`/api/trainer/programs/${programId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: true }),
    });
    load();
  }

  if (loading) return <div className="p-8 text-stone-500">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800">{title}</h1>
      <p className="text-sm text-stone-500 mt-1">
        Plan workouts on the calendar. Build exercise content from a client workout (send-to-client flow) — copy into program workouts next, or we&apos;ll wire the full builder here.
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" onClick={() => void addWorkout()} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium">
          + Add workout slot
        </button>
        <button type="button" onClick={() => void togglePublished()} className="px-3 py-1.5 rounded-lg border border-stone-300 text-sm">
          Mark published
        </button>
      </div>

      <div className="mt-6">
        <ProgramCalendarBoard
          workouts={workouts}
          onMove={moveWorkout}
          editHref={(wid) => `/trainer/programs/${programId}/workouts/${wid}/edit`}
        />
      </div>

      <div className="mt-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-2">
        <h2 className="font-semibold text-stone-800 text-sm">Duplicate week / block</h2>
        <p className="text-xs text-stone-500">Copy days (e.g. week 1 → week 2) for progressive blocks, deloads, etc.</p>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <label>
            From day
            <input value={dupFrom} onChange={(e) => setDupFrom(e.target.value)} className="ml-1 w-14 px-2 py-1 border rounded" />
          </label>
          <label>
            to
            <input value={dupTo} onChange={(e) => setDupTo(e.target.value)} className="ml-1 w-14 px-2 py-1 border rounded" />
          </label>
          <label>
            paste starting day
            <input value={dupTarget} onChange={(e) => setDupTarget(e.target.value)} className="ml-1 w-14 px-2 py-1 border rounded" />
          </label>
          <label>
            copies
            <input value={dupCopies} onChange={(e) => setDupCopies(e.target.value)} className="ml-1 w-14 px-2 py-1 border rounded" />
          </label>
          <button type="button" onClick={() => void duplicateBlock()} className="px-3 py-1.5 rounded-lg border text-sm hover:bg-white">
            Duplicate
          </button>
        </div>
      </div>

      <div className="mt-6 p-4 rounded-xl border border-stone-200 bg-white space-y-2">
        <h2 className="font-semibold text-stone-800 text-sm">Send to client</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client member ID"
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-stone-200 text-sm"
          />
          <button type="button" onClick={() => void assignClient()} className="px-4 py-2 rounded-lg bg-stone-800 text-white text-sm">
            Assign program
          </button>
        </div>
        {assignMsg && <p className="text-sm text-stone-600">{assignMsg}</p>}
      </div>

      <p className="mt-8">
        <Link href="/trainer/programs" className="text-sm text-brand-600 hover:underline">
          ← All programs
        </Link>
      </p>
    </div>
  );
}