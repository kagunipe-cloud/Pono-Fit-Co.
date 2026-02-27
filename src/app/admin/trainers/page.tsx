"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Trainer = { member_id: string; display_name: string };

export default function AdminTrainersPage() {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Trainer[]) => setTrainers(Array.isArray(data) ? data : []))
      .catch(() => setTrainers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Trainers</h1>
      <p className="text-sm text-stone-600 mb-4">
        Add trainers and view their schedules. Trainers can set their own PT availability from the trainer area.
      </p>
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href="/admin/trainers/new" className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Add trainer
        </Link>
        <Link href="/admin/block-time" className="px-4 py-2.5 rounded-lg border border-stone-200 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Block time
        </Link>
        <Link href="/master-schedule" className="px-4 py-2.5 rounded-lg border border-stone-200 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Master Schedule
        </Link>
      </div>

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
        <ul className="space-y-3">
          {trainers.map((t) => (
            <li key={t.member_id} className="p-4 rounded-xl border border-stone-200 bg-white flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-stone-800">{t.display_name}</p>
                <p className="text-xs text-stone-500">Member ID: {t.member_id}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/schedule?trainer=${encodeURIComponent(t.member_id)}`}
                  className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  View schedule
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

