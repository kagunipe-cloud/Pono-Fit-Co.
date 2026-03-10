"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Member = { member_id: string; first_name: string | null; last_name: string | null; email: string | null };
type PtSession = { id: number; session_name: string; duration_minutes: number; price: string; trainer: string | null };
type Trainer = { member_id: string; display_name: string };

function normalizeTimeToHHmm(t: string): string {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = (parts[0] ?? 0) % 24;
  const m = Math.min(59, Math.max(0, parts[1] ?? 0));
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function AdminBookPTForMemberContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = searchParams.get("date")?.trim() || "";
  const time = searchParams.get("time")?.trim() || "";
  const block = searchParams.get("block")?.trim() || "";

  const [members, setMembers] = useState<Member[]>([]);
  const [sessions, setSessions] = useState<PtSession[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [useCreditSubmitting, setUseCreditSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<number, number>>({ 30: 0, 60: 0, 90: 0 });

  useEffect(() => {
    fetch("/api/members")
      .then((r) => r.json())
      .then((list) => setMembers(Array.isArray(list) ? list : []))
      .catch(() => setMembers([]));
    fetch("/api/offerings/pt-session-products")
      .then((r) => r.json())
      .then((list) => setSessions(Array.isArray(list) ? list : []))
      .catch(() => setSessions([]));
    fetch("/api/trainers")
      .then((r) => r.json())
      .then((list) => setTrainers(Array.isArray(list) ? list : []))
      .catch(() => setTrainers([]));
  }, []);

  const filteredMembers = useMemo(() => {
    if (!memberQuery.trim()) return members.slice(0, 50);
    const q = memberQuery.toLowerCase();
    return members.filter(
      (m) =>
        (m.first_name ?? "").toLowerCase().includes(q) ||
        (m.last_name ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q) ||
        (m.member_id ?? "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [members, memberQuery]);

  const selectedSession = selectedSessionId != null ? sessions.find((s) => s.id === selectedSessionId) : null;
  const startTime = time ? normalizeTimeToHHmm(time) : "";

  useEffect(() => {
    if (!selectedMemberId) {
      setCredits({ 30: 0, 60: 0, 90: 0 });
      return;
    }
    fetch(`/api/members/${encodeURIComponent(selectedMemberId)}/pt-credits`)
      .then((r) => (r.ok ? r.json() : { 30: 0, 60: 0, 90: 0 }))
      .then((b) => setCredits(b ?? { 30: 0, 60: 0, 90: 0 }))
      .catch(() => setCredits({ 30: 0, 60: 0, 90: 0 }));
  }, [selectedMemberId]);

  const duration = selectedSession?.duration_minutes ?? 60;
  const hasCredit = (credits[duration as keyof typeof credits] ?? 0) >= 1;

  async function handleUseCredit() {
    if (!selectedMemberId || !selectedSessionId || !date || !startTime) {
      setError("Select a member and a PT session. Date and time must be in the URL.");
      return;
    }
    if (!hasCredit) {
      setError("Member has no PT credits for this session duration.");
      return;
    }
    setError(null);
    setUseCreditSubmitting(true);
    try {
      if (block) {
        const blockId = parseInt(block, 10);
        if (Number.isNaN(blockId)) throw new Error("Invalid block ID");
        const res = await fetch("/api/pt-bookings/book-block", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainer_availability_id: blockId,
            occurrence_date: date,
            start_time: startTime,
            session_duration_minutes: duration,
            member_id: selectedMemberId,
            use_credit: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Booking failed");
        router.push("/master-schedule");
      } else {
        const res = await fetch("/api/pt-bookings/book-open-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: selectedMemberId,
            occurrence_date: date,
            start_time: startTime,
            duration_minutes: duration,
            pt_session_id: selectedSessionId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Booking failed");
        router.push("/master-schedule");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setUseCreditSubmitting(false);
    }
  }

  async function handleAddToCart() {
    if (!selectedMemberId || !selectedSessionId || !date || !startTime) {
      setError("Select a member and a PT session. Date and time must be in the URL.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: selectedMemberId,
          product_type: "pt_session",
          product_id: selectedSessionId,
          quantity: 1,
          slot: {
            date,
            start_time: startTime,
            duration_minutes: selectedSession?.duration_minutes ?? 60,
            ...(selectedTrainerId ? { trainer_member_id: selectedTrainerId } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add to cart");
      router.push(`/members/${selectedMemberId}/cart`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to cart");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = selectedMemberId && selectedSessionId && date && startTime;

  return (
    <div className="max-w-lg mx-auto">
      <Link href="/master-schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to Master Schedule</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Book PT for member</h1>
      <p className="text-stone-500 text-sm mb-6">Select the member, choose session type. Use their credit if they have one, or add to cart to charge.</p>

      <div className="mb-4 p-3 rounded-lg bg-stone-100 text-sm">
        <span className="font-medium text-stone-700">Slot: </span>
        {date && startTime ? `${date} at ${startTime}` : "No date/time in URL — open from Master Schedule."}
        {block && <span className="text-stone-500"> (block {block})</span>}
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Member to charge</label>
          <input
            type="text"
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="Search by name, email, or member ID"
            className="w-full px-3 py-2 rounded-lg border border-stone-200 mb-2"
          />
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white"
            size={6}
          >
            <option value="">— Select member —</option>
            {filteredMembers.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {[m.first_name, m.last_name].filter(Boolean).join(" ")} ({m.member_id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">PT session type</label>
          <select
            value={selectedSessionId ?? ""}
            onChange={(e) => setSelectedSessionId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white"
          >
            <option value="">— Select session —</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.session_name} — {s.duration_minutes} min · ${s.price}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Assign to trainer (optional)</label>
          <select
            value={selectedTrainerId}
            onChange={(e) => setSelectedTrainerId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white"
          >
            <option value="">— No preference (leave open) —</option>
            {trainers.map((t) => (
              <option key={t.member_id} value={t.member_id}>
                {t.display_name}
              </option>
            ))}
          </select>
          <p className="text-xs text-stone-500 mt-1">Leave open to assign later from the Master Schedule.</p>
        </div>
      </div>

      {error && <p className="mb-4 text-red-600 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {hasCredit && (
          <button
            type="button"
            onClick={handleUseCredit}
            disabled={!canSubmit || useCreditSubmitting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {useCreditSubmitting ? "Booking…" : "Use 1 credit (free)"}
          </button>
        )}
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!canSubmit || submitting}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add to cart & pay"}
        </button>
        <Link href="/master-schedule" className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium">
          Cancel
        </Link>
      </div>

      <p className="mt-4 text-stone-500 text-xs">
        {hasCredit ? `Member has ${credits[duration as keyof typeof credits] ?? 0}×${duration}-min credit(s). ` : ""}
        “Add to cart” takes you to checkout to charge their card or pay in-person.
      </p>
    </div>
  );
}

export default function AdminBookPTForMemberPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <AdminBookPTForMemberContent />
    </Suspense>
  );
}
