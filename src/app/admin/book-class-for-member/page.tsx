"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Member = { member_id: string; first_name: string | null; last_name: string | null; email: string | null };
type Occurrence = {
  id: number;
  occurrence_date: string;
  occurrence_time: string;
  capacity: number | null;
  class_name: string | null;
  instructor: string | null;
  price: string;
  booked_count: number;
};

export default function AdminBookClassForMemberPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const occurrenceIdParam = searchParams.get("occurrence_id")?.trim() || "";

  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!occurrenceIdParam) {
      setOccurrenceError("No occurrence_id in URL — open from Master Schedule.");
      return;
    }
    const id = parseInt(occurrenceIdParam, 10);
    if (Number.isNaN(id)) {
      setOccurrenceError("Invalid occurrence_id.");
      return;
    }
    fetch(`/api/offerings/class-occurrences/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Occurrence not found");
        return r.json();
      })
      .then((data) => setOccurrence(data))
      .catch(() => setOccurrenceError("Could not load class occurrence."));
  }, [occurrenceIdParam]);

  useEffect(() => {
    fetch("/api/members")
      .then((r) => r.json())
      .then((list) => setMembers(Array.isArray(list) ? list : []))
      .catch(() => setMembers([]));
  }, []);

  const filteredMembers = useMemo(() => {
    if (!memberQuery.trim()) return members.slice(0, 50);
    const q = memberQuery.toLowerCase();
    return members
      .filter(
        (m) =>
          (m.first_name ?? "").toLowerCase().includes(q) ||
          (m.last_name ?? "").toLowerCase().includes(q) ||
          (m.email ?? "").toLowerCase().includes(q) ||
          (m.member_id ?? "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [members, memberQuery]);

  async function handleAddToCart() {
    if (!selectedMemberId || !occurrence) {
      setError("Select a member. Class occurrence must be loaded.");
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
          product_type: "class_occurrence",
          product_id: occurrence.id,
          quantity: 1,
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

  const canSubmit = selectedMemberId && occurrence;

  return (
    <div className="max-w-lg mx-auto">
      <Link href="/master-schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Back to Master Schedule
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Book class for member</h1>
      <p className="text-stone-500 text-sm mb-6">
        Select the member to charge, then add this class to their cart and check out.
      </p>

      {occurrenceError && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">{occurrenceError}</div>
      )}

      {occurrence && (
        <div className="mb-4 p-3 rounded-lg bg-stone-100 text-sm">
          <span className="font-medium text-stone-700">{occurrence.class_name ?? "Class"}</span>
          {occurrence.instructor && <span className="text-stone-500"> — {occurrence.instructor}</span>}
          <span className="text-stone-500 block mt-0.5">
            {occurrence.occurrence_date} at {occurrence.occurrence_time} · ${occurrence.price}
            {occurrence.capacity != null && ` · ${occurrence.booked_count}/${occurrence.capacity} booked`}
          </span>
        </div>
      )}

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
      </div>

      {error && <p className="mb-4 text-red-600 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!canSubmit || submitting}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add to cart & go to checkout"}
        </button>
        <Link
          href="/master-schedule"
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Cancel
        </Link>
      </div>

      <p className="mt-4 text-stone-500 text-xs">
        You’ll be taken to the member’s cart. Use “Pay with Stripe” to charge their card or complete in-person with your
        Stripe reader.
      </p>
    </div>
  );
}
