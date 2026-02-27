"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Booking = { class_name?: string; class_date?: string; class_time?: string; booking_date?: string; payment_status?: string };
type OccurrenceBooking = { id?: number; class_name?: string; occurrence_date?: string; occurrence_time?: string };

export default function MemberClassBookingsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ classBookings: Booking[]; occurrenceBookings?: OccurrenceBooking[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/member/me")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return null;

  const bookings = data.classBookings ?? [];
  const occurrenceBookings = (data.occurrenceBookings ?? []).filter((o: OccurrenceBooking) => String(o.occurrence_date ?? "") >= new Date().toISOString().slice(0, 10));

  async function cancelOccurrence(b: OccurrenceBooking) {
    if (b.id == null) return;
    if (!confirm("Cancel this class booking? You can cancel up to 24 hours before the start time.")) return;
    setCancellingId(b.id);
    try {
      const res = await fetch(`/api/member/class-bookings/${b.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setData((d) =>
          d
            ? {
                ...d,
                occurrenceBookings: (d.occurrenceBookings ?? []).filter((ob: OccurrenceBooking) => ob.id !== b.id),
              }
            : d
        );
      } else {
        alert(json.error ?? "Unable to cancel booking");
      }
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">My Class Bookings</h1>
      {bookings.length === 0 && occurrenceBookings.length === 0 ? (
        <p className="text-stone-500">You don’t have any class bookings yet.</p>
      ) : (
        <>
          {occurrenceBookings.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-medium text-stone-500 mb-2">Upcoming (Booked With Credits)</h2>
              <ul className="space-y-4">
                {occurrenceBookings.map((b, i) => (
                  <li key={i} className="p-4 rounded-xl border border-stone-200 bg-white flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-stone-800">{b.class_name ?? "Class"}</p>
                      <p className="text-sm text-stone-500">
                        {b.occurrence_date} at {b.occurrence_time}
                      </p>
                    </div>
                    {b.id != null && (
                      <button
                        type="button"
                        onClick={() => cancelOccurrence(b)}
                        disabled={cancellingId === b.id}
                        className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        {cancellingId === b.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {bookings.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-stone-500 mb-2">Drop-In / Other</h2>
              <ul className="space-y-4">
                {bookings.map((b, i) => (
                  <li key={i} className="p-4 rounded-xl border border-stone-200 bg-white">
                    <p className="font-medium text-stone-800">{b.class_name ?? "Class"}</p>
                    <p className="text-sm text-stone-500">{b.class_date} {b.class_time} · {b.payment_status ?? ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="mt-6">
        <Link href="/member/book-classes" className="text-brand-600 hover:underline">Book a class →</Link>
      </p>
    </div>
  );
}
