"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Program = {
  id: number;
  title: string;
  is_for_sale: number;
  price_cents: number | null;
  published: number;
  workout_count: number;
  updated_at: string;
};

export default function TrainerProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trainer/programs")
      .then((r) => (r.ok ? r.json() : { programs: [] }))
      .then((d) => setPrograms(Array.isArray(d.programs) ? d.programs : []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">My Created Programs</h1>
        <Link
          href="/trainer/programs/new"
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          New program
        </Link>
      </div>
      <p className="text-sm text-stone-600 mb-6">
        Build multi-day programs, assign them to clients, or list them for sale. Drag workouts on the calendar; duplicate weeks for blocks and progressive phases.
      </p>

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-stone-500 text-sm">No programs yet — create one to get started.</p>
      ) : (
        <ul className="space-y-2">
          {programs.map((p) => (
            <li key={p.id}>
              <Link
                href={`/trainer/programs/${p.id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-brand-300"
              >
                <p className="font-semibold text-stone-900">{p.title}</p>
                <p className="text-xs text-stone-500 mt-1">
                  {p.workout_count} workouts
                  {p.is_for_sale ? ` · For sale${p.price_cents != null ? ` $${(p.price_cents / 100).toFixed(2)}` : ""}` : ""}
                  {p.published ? " · Published" : " · Draft"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8">
        <Link href="/trainer" className="text-sm text-brand-600 hover:underline">
          ← Trainer home
        </Link>
      </p>
    </div>
  );
}