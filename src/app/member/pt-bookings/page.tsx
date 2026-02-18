"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Booking = { session_name?: string; session_date?: string; booking_date?: string; payment_status?: string; source?: string };

export default function MemberPTBookingsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ ptBookings: Booking[] } | null>(null);
  const [loading, setLoading] = useState(true);

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

  const bookings = data.ptBookings;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">My PT Bookings</h1>
      {bookings.length === 0 ? (
        <p className="text-stone-500">You don’t have any PT bookings yet.</p>
      ) : (
        <ul className="space-y-4">
          {bookings.map((b, i) => (
            <li key={i} className="p-4 rounded-xl border border-stone-200 bg-white">
              <p className="font-medium text-stone-800">{b.session_name ?? "PT session"}</p>
              <p className="text-sm text-stone-500">
                {b.session_date ?? b.booking_date}
                {b.payment_status ? ` · ${b.payment_status}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6">
        <Link href="/member/book-pt" className="text-brand-600 hover:underline">
          Book PT →
        </Link>
      </p>
    </div>
  );
}
