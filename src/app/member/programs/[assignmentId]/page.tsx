"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProgramMonthCalendar, { type ScheduledWorkout } from "@/components/member/ProgramMonthCalendar";
import { useAppTimezone } from "@/lib/settings-context";
import { todayInAppTz } from "@/lib/app-timezone";

export default function MemberProgramDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tz = useAppTimezone();
  const today = todayInAppTz(tz);
  const assignmentId = params.assignmentId as string;
  const [title, setTitle] = useState("");
  const [workouts, setWorkouts] = useState<ScheduledWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/member/programs/assignments/${assignmentId}`)
      .then((r) => {
        if (r.status === 401) {
          router.replace(`/login?next=/member/programs/${assignmentId}`);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (!d) return;
        setTitle(d.assignment?.title ?? "Program");
        const list = Array.isArray(d.workouts) ? d.workouts : [];
        setWorkouts(
          list.map((w: Record<string, unknown>) => ({
            id: w.id as number,
            name: String(w.name ?? "Workout"),
            training_phase: String(w.training_phase ?? ""),
            scheduled_date: String(w.scheduled_date ?? ""),
            exercise_count: Number(w.exercise_count ?? 0),
            sort_order: Number(w.sort_order ?? 0),
          }))
        );
      })
      .finally(() => setLoading(false));
  }, [assignmentId, router]);

  async function startWorkout(programWorkoutId: number) {
    setError(null);
    setStartingId(programWorkoutId);
    try {
      const res = await fetch(`/api/member/programs/assignments/${assignmentId}/start/${programWorkoutId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start workout");
        if (data.open_workout_id) router.push(`/member/workouts/${data.open_workout_id}`);
        return;
      }
      router.push(`/member/workouts/${data.workout_id}`);
    } finally {
      setStartingId(null);
    }
  }

  if (loading) return <div className="p-8 text-stone-500">Loading…</div>;

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800">{title}</h1>
      <p className="text-sm text-stone-500 mt-1">
        Your month at a glance — today is highlighted. Start today&apos;s workout or pick any scheduled day.
      </p>
      {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

      <div className="mt-6">
        <ProgramMonthCalendar
          todayYmd={today}
          timeZone={tz}
          workouts={workouts}
          startingId={startingId}
          onStart={(id) => void startWorkout(id)}
        />
      </div>

      <p className="mt-8">
        <Link href="/member/programs" className="text-sm text-brand-600 hover:underline">
          ← All programs
        </Link>
      </p>
    </div>
  );
}