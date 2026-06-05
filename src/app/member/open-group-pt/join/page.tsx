"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateForDisplay } from "@/lib/app-timezone";
import {
  isOpenGroupSessionKind,
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
} from "@/lib/open-group-pt";

type OccurrenceDetail = {
  id: number;
  class_name: string | null;
  instructor: string | null;
  occurrence_date: string;
  occurrence_time: string;
  capacity: number | null;
  booked_count: number;
  session_kind?: string;
  flat_session_price?: string | null;
};

function JoinOpenGroupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const occurrenceIdRaw = searchParams.get("occurrence_id")?.trim() ?? "";
  const tokenFromUrl = searchParams.get("token")?.trim() ?? "";

  const occurrenceId = parseInt(occurrenceIdRaw, 10);
  const [tokenInput, setTokenInput] = useState(tokenFromUrl);
  useEffect(() => {
    setTokenInput(tokenFromUrl);
  }, [tokenFromUrl]);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [occurrence, setOccurrence] = useState<OccurrenceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setMemberId(me?.member_id ?? null))
      .catch(() => setMemberId(null));
  }, []);

  useEffect(() => {
    if (Number.isNaN(occurrenceId)) {
      setLoadError("Missing or invalid occurrence in this link.");
      setLoading(false);
      return;
    }
    fetch(`/api/offerings/class-occurrences/${occurrenceId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: OccurrenceDetail) => {
        setOccurrence(data);
        if (!isOpenGroupSessionKind(data.session_kind)) {
          setLoadError("This session is not Open Group Personal Training.");
        }
      })
      .catch(() => setLoadError("Could not load this class time."))
      .finally(() => setLoading(false));
  }, [occurrenceId]);

  const deskFlat = occurrence?.flat_session_price ?? OPEN_GROUP_DEFAULT_FLAT_PRICE;
  const loginNext = `/member/open-group-pt/join?occurrence_id=${occurrenceId}&token=${encodeURIComponent(tokenInput)}`;
  const loginHref = `/login?next=${encodeURIComponent(loginNext)}`;

  async function handleJoin() {
    setJoinError(null);
    const tok = tokenInput.trim();
    if (!tok) {
      setJoinError("Paste the invite token from your friend’s link, or open the full invite link.");
      return;
    }
    setJoining(true);
    try {
      const res = await fetch("/api/class-bookings/book-open-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_occurrence_id: occurrenceId, invite_token: tok }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJoinError(typeof data.error === "string" ? data.error : "Could not join this group.");
        return;
      }
      router.push(`/member/book-classes?occurrence=${occurrenceId}`);
    } finally {
      setJoining(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-lg mx-auto p-6">
      <Link href="/schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Schedule
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Join Open Group PT</h1>
      <p className="text-stone-600 text-sm mb-6">
        Sign-up here is free. Your group pays <strong>${deskFlat} total at the gym</strong> for the session (not per person online).
      </p>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm border border-amber-200">{loadError}</div>
      )}

      {occurrence && !loadError && (
        <div className="mb-6 p-4 rounded-xl border border-orange-200 bg-orange-50/50">
          <p className="font-medium text-stone-800">{occurrence.class_name ?? "Open Group Personal Training"}</p>
          <p className="text-sm text-stone-600 mt-1">
            {formatDateForDisplay(occurrence.occurrence_date)} at {occurrence.occurrence_time}
            {occurrence.instructor ? ` · ${occurrence.instructor}` : ""}
          </p>
          <p className="text-sm text-stone-500 mt-1">
            {occurrence.booked_count}/{occurrence.capacity ?? "—"} booked
          </p>
        </div>
      )}

      {!memberId ? (
        <div className="space-y-3">
          <p className="text-stone-700 text-sm">Log in with the account that should join this group.</p>
          <Link
            href={loginHref}
            className="inline-block px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700"
          >
            Log in to join
          </Link>
        </div>
      ) : occurrence && isOpenGroupSessionKind(occurrence.session_kind) ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Invite token</label>
            <p className="text-xs text-stone-500 mb-2">
              If you opened the organizer’s link, this field should already be filled. Otherwise paste the token from their message.
            </p>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
              placeholder="Paste token from invite link"
              autoComplete="off"
            />
          </div>
          {joinError && <p className="text-red-600 text-sm">{joinError}</p>}
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={joining}
            className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
          >
            {joining ? "Joining…" : "Join this group"}
          </button>
        </div>
      ) : null}

      <p className="mt-8 text-sm text-stone-500">
        Starting a new group? Pick an empty orange slot on the{" "}
        <Link href="/schedule" className="text-orange-700 hover:underline font-medium">
          schedule
        </Link>
        .
      </p>
    </div>
  );
}

export default function JoinOpenGroupPtPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <JoinOpenGroupContent />
    </Suspense>
  );
}
