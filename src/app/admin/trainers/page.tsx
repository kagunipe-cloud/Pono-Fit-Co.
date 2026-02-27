"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScheduleGrid from "@/components/ScheduleGrid";

type Trainer = { member_id: string; display_name: string };

export default function AdminTrainersPage() {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selected = trainers.find((t) => t.member_id === selectedId) || null;

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
                  />
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


