"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import TrainerWorkoutExerciseBuilder from "@/components/trainer/TrainerWorkoutExerciseBuilder";
import {
  type ExerciseEntry,
  exerciseEntriesToPayload,
  parseExerciseEntriesFromApi,
} from "@/lib/trainer-workout-builder";

export default function TrainerCreateWorkoutPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <TrainerCreateWorkoutInner />
    </Suspense>
  );
}

function TrainerCreateWorkoutInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = (params.clientId as string) ?? "";
  const editRaw = searchParams.get("edit");
  const editingWorkoutId =
    editRaw != null && /^\d+$/.test(editRaw.trim()) ? parseInt(editRaw.trim(), 10) : null;

  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [trainerNotes, setTrainerNotes] = useState("");
  const [loadingEdit, setLoadingEdit] = useState(editingWorkoutId != null);

  useEffect(() => {
    if (editingWorkoutId == null || !clientId) {
      setLoadingEdit(false);
      return;
    }
    let cancelled = false;
    setLoadingEdit(true);
    fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/workouts/${editingWorkoutId}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          error?: string;
          trainer_notes?: string;
          exercises?: unknown[];
          finished_at?: string | null;
        };
        if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load workout");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.finished_at) {
          setError("This workout is already completed and can’t be edited here.");
          setLoadingEdit(false);
          return;
        }
        setTrainerNotes(data.trainer_notes ?? "");
        setExercises(Array.isArray(data.exercises) ? parseExerciseEntriesFromApi(data.exercises) : []);
        setLoadingEdit(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load workout for editing.");
          setLoadingEdit(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editingWorkoutId, clientId]);

  async function handleSubmitWorkout(intent: "send" | "finish" | "patch") {
    setError(null);
    setSuccess(null);
    if (!clientId) {
      setError("Client not found.");
      return;
    }
    if (exercises.length === 0) {
      setError("Add at least one exercise.");
      return;
    }

    const exercisesPayload = exerciseEntriesToPayload(exercises);

    setSubmitting(true);
    try {
      if (intent === "patch") {
        if (editingWorkoutId == null) return;
        const res = await fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/workouts/${editingWorkoutId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trainer_notes: trainerNotes, exercises: exercisesPayload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string }).error ?? "Failed to update workout");
          return;
        }
        setSuccess((data as { message?: string }).message ?? "Workout updated. The client will see changes when they refresh.");
        setTimeout(() => router.push(`/trainer/my-clients/${clientId}`), 1200);
        return;
      }

      const res = await fetch("/api/trainer/workouts/create-for-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_member_id: clientId,
          trainer_notes: trainerNotes.trim() || undefined,
          exercises: exercisesPayload,
          save_as_completed: intent === "finish",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to save workout");
        return;
      }
      setSuccess(
        (data as { message?: string }).message ??
          (intent === "finish"
            ? "Workout saved on the client’s history."
            : "Workout sent. Client will see it under Workouts from my trainer.")
      );
      setExercises([]);
      setTimeout(() => router.push(`/trainer/my-clients/${clientId}`), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  if (!clientId) return <div className="p-6 text-stone-500">No client selected.</div>;
  if (loadingEdit) return <div className="p-8 text-center text-stone-500">Loading workout…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <Link href={`/trainer/my-clients/${clientId}`} className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Client dashboard
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">{editingWorkoutId != null ? "Edit workout" : "Create Workout for Member"}</h1>
        <p className="text-stone-500 text-sm mt-1">
          {editingWorkoutId != null
            ? "Update exercises or notes before your client finishes this workout. Saving replaces all prescribed sets — if they’ve already changed reps or weights on their phone, those edits will be overwritten when they refresh."
            : "Add exercises and optional suggested sets. Send it for them to complete in the app, or save it as finished after an in-person session so it appears on their workout history right away."}
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 text-sm">{success}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmitWorkout(editingWorkoutId != null ? "patch" : "send");
        }}
        className="space-y-8"
      >
        <TrainerWorkoutExerciseBuilder exerciseSearchMemberId={clientId} exercises={exercises} onExercisesChange={setExercises} />

        <div className="pt-4 border-t border-stone-200">
          <label className="block text-sm font-medium text-stone-700 mb-1">Notes to client (optional)</label>
          <textarea
            value={trainerNotes}
            onChange={(e) => setTrainerNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm min-h-[80px]"
            placeholder="e.g. Focus on form today. Go heavy on set 2."
            rows={3}
          />
          <p className="text-xs text-stone-500 mt-1">
            The client will see this when they open the workout.
            {editingWorkoutId != null ? " Updating replaces your previous note." : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {editingWorkoutId != null ? (
            <button
              type="submit"
              disabled={submitting || exercises.length === 0}
              className="px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          ) : (
            <>
              <button
                type="submit"
                disabled={submitting || exercises.length === 0}
                className="px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Saving…" : "Send workout to client"}
              </button>
              <button
                type="button"
                disabled={submitting || exercises.length === 0}
                onClick={() => void handleSubmitWorkout("finish")}
                className="px-6 py-3 rounded-lg border-2 border-brand-600 text-brand-700 font-medium hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Saving…" : "Save as completed workout"}
              </button>
            </>
          )}
          <Link href={`/trainer/my-clients/${clientId}`} className="px-6 py-3 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium text-stone-700">
            Cancel
          </Link>
        </div>
        {editingWorkoutId == null && (
          <p className="text-xs text-stone-500 -mt-4">
            <span className="font-medium text-stone-600">Send</span> leaves it open under Workouts from my trainer.
            <span className="font-medium text-stone-600"> Save as completed</span> logs it like a finished session (good after you trained together in person).
          </p>
        )}
      </form>
    </div>
  );
}