"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ScheduleGrid from "@/components/ScheduleGrid";

type Trainer = { member_id: string; display_name: string };

function ScheduleContent() {
  const searchParams = useSearchParams();
  const trainerFromUrl = searchParams.get("trainer")?.trim() || null;
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(trainerFromUrl);

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => r.json())
      .then((data: Trainer[]) => setTrainers(Array.isArray(data) ? data : []))
      .catch(() => setTrainers([]));
  }, []);

  // Sync selection with URL when opening a link from Trainer schedules (e.g. /schedule?trainer=xxx)
  useEffect(() => {
    if (trainerFromUrl !== null) setSelectedTrainerId(trainerFromUrl);
  }, [trainerFromUrl]);

  return (
    <div>
      {trainers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-600">PT trainer:</span>
          <button
            type="button"
            onClick={() => setSelectedTrainerId(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectedTrainerId === null ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
          >
            All
          </button>
          {trainers.map((t) => (
            <button
              key={t.member_id}
              type="button"
              onClick={() => setSelectedTrainerId(t.member_id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectedTrainerId === t.member_id ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
            >
              {t.display_name}
            </button>
          ))}
        </div>
      )}
      <ScheduleGrid variant="member" trainerMemberId={selectedTrainerId ?? undefined} />
    </div>
  );
}

/** Member schedule: same grid but gray blocks (unavailable / booked) are not labeled. Optional filter by PT trainer. */
export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Loading schedule…</div>}>
      <ScheduleContent />
    </Suspense>
  );
}
