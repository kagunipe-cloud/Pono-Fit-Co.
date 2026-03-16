"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import ScheduleGrid from "@/components/ScheduleGrid";

type Trainer = { member_id: string; display_name: string };

function ScheduleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trainerFromUrl = searchParams.get("trainer")?.trim() || null;
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(trainerFromUrl);
  const [isGuest, setIsGuest] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => setIsGuest(!r.ok))
      .catch(() => setIsGuest(true));
  }, []);

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => r.json())
      .then((data: Trainer[]) => setTrainers(Array.isArray(data) ? data : []))
      .catch(() => setTrainers([]));
  }, []);

  // Sync selection with URL when opening a link (e.g. /schedule?trainer=xxx)
  useEffect(() => {
    if (trainerFromUrl !== null) setSelectedTrainerId(trainerFromUrl);
  }, [trainerFromUrl]);

  function selectTrainer(id: string | null) {
    setSelectedTrainerId(id);
    router.replace(id ? `/schedule?trainer=${encodeURIComponent(id)}` : "/schedule");
  }

  return (
    <div>
      {isGuest === true && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-stone-700">
          <span className="font-medium">Log in or create an account</span> to book classes and PT sessions.
          {" "}
          <Link href="/login" className="text-brand-600 hover:underline font-medium">Log in</Link>
          {" · "}
          <Link href="/signup" className="text-brand-600 hover:underline font-medium">Sign up</Link>
        </div>
      )}
      {trainers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-600">PT trainer:</span>
          <button
            type="button"
            onClick={() => selectTrainer(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectedTrainerId === null ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
          >
            No Preference
          </button>
          {trainers.map((t) => (
            <button
              key={t.member_id}
              type="button"
              onClick={() => selectTrainer(t.member_id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectedTrainerId === t.member_id ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
            >
              {t.display_name}
            </button>
          ))}
          {selectedTrainerId === null && (
            <span className="text-sm text-stone-500 ml-1">— see all availability</span>
          )}
          {selectedTrainerId !== null && (
            <span className="text-sm text-stone-500 ml-1">— only this trainer’s availability</span>
          )}
        </div>
      )}
      <ScheduleGrid
        variant="member"
        trainerMemberId={selectedTrainerId ?? undefined}
        trainerDisplayName={trainers.find((t) => t.member_id === selectedTrainerId)?.display_name ?? undefined}
      />
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
