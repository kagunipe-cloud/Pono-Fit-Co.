"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Occurrence = { id: number; class_name: string; instructor: string | null; occurrence_date: string; occurrence_time: string; booked_count: number; capacity: number; price: string };

export default function MemberBookClassesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const occurrenceIdParam = searchParams.get("occurrence");
  const highlightId = occurrenceIdParam ? parseInt(occurrenceIdParam, 10) : null;
  const refMap = useRef<Record<number, HTMLLIElement | null>>({});
  const [memberId, setMemberId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/member/class-credits").then((r) => (r.ok ? r.json() : { balance: 0 })),
      fetch(`/api/offerings/class-occurrences?from=${new Date().toISOString().slice(0, 10)}&to=${(() => { const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); })()}`).then((r) => r.json()),
    ])
      .then(([me, cred, occ]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setCredits(cred.balance ?? 0);
        setOccurrences(Array.isArray(occ) ? occ : []);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (loading || !highlightId || !refMap.current[highlightId]) return;
    refMap.current[highlightId]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, highlightId, occurrences.length]);

  async function bookWithCredit(occurrenceId: number) {
    if (credits !== null && credits < 1) return;
    setBookingId(occurrenceId);
    try {
      const res = await fetch("/api/class-bookings/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_occurrence_id: occurrenceId }),
      });
      const data = await res.json();
      if (res.ok) {
        setCredits(data.balance ?? credits! - 1);
        const to = new Date();
        to.setDate(to.getDate() + 28);
        fetch(`/api/offerings/class-occurrences?from=${new Date().toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`).then((r) => r.json()).then(setOccurrences);
      } else {
        alert(data.error ?? "Booking failed");
      }
    } finally {
      setBookingId(null);
    }
  }

  async function addToCart(occurrenceId: number) {
    if (!memberId) return;
    setAddingId(occurrenceId);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "class_occurrence", product_id: occurrenceId, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not add to cart");
      }
    } finally {
      setAddingId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const formatPrice = (p: string) => {
    const n = parseFloat(String(p));
    if (Number.isNaN(n) || n === 0) return "Free";
    return `$${n.toFixed(2)}`;
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Book a Class</h1>
      <p className="text-stone-600 mb-6">
        Pay for a single class or use a class credit. You have <strong>{credits ?? 0} class credits</strong>. <Link href="/member/class-packs" className="text-brand-600 hover:underline">Class packs</Link> are a separate purchase; then book with credit or pay per class.
      </p>
      {credits !== null && credits < 1 && (
        <p className="mb-6 p-4 rounded-lg bg-amber-50 text-amber-800 text-sm">
          No credits. <Link href="/member/class-packs" className="underline">Buy a class pack</Link> to use credits, or pay per class below.
        </p>
      )}
      <ul className="space-y-4">
        {occurrences.map((o) => (
          <li
            key={o.id}
            ref={(el) => { refMap.current[o.id] = el; }}
            className={`p-4 rounded-xl border bg-white flex flex-wrap items-center justify-between gap-2 ${highlightId === o.id ? "border-brand-400 ring-2 ring-brand-200" : "border-stone-200"}`}
          >
            <div>
              <p className="font-medium text-stone-800">{o.class_name}</p>
              <p className="text-sm text-stone-500">{o.occurrence_date} at {o.occurrence_time} · {o.instructor ?? "—"} · {o.booked_count}/{o.capacity} booked · {formatPrice(o.price ?? "0")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addToCart(o.id)}
                disabled={addingId !== null}
                className="px-4 py-2 rounded-lg border border-stone-300 bg-white text-stone-700 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              >
                {addingId === o.id ? "Adding…" : `Pay ${formatPrice(o.price ?? "0")}`}
              </button>
              <button
                type="button"
                onClick={() => bookWithCredit(o.id)}
                disabled={(credits ?? 0) < 1 || bookingId !== null}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bookingId === o.id ? "Booking…" : "Use 1 credit"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {occurrences.length === 0 && <p className="text-stone-500">No upcoming classes in the next 4 weeks.</p>}
      <p className="mt-6 flex gap-4">
        <Link href="/member/cart" className="text-brand-600 hover:underline">Cart →</Link>
        <Link href="/member/class-bookings" className="text-brand-600 hover:underline">My class bookings →</Link>
      </p>
    </div>
  );
}
