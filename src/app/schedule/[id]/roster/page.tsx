"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatDateForDisplay } from "@/lib/app-timezone";
import { isOpenGroupSessionKind, OPEN_GROUP_DEFAULT_FLAT_PRICE } from "@/lib/open-group-pt";

type Member = {
  booking_id: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  booking_role?: string;
};
type Roster = {
  occurrence: {
    class_name: string;
    occurrence_date: string;
    occurrence_time: string;
    instructor: string | null;
    session_kind?: string;
    flat_session_price?: string | null;
  };
  members: Member[];
};

export default function RosterPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/offerings/class-occurrences/${id}/roster`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rosterData, memberData]) => {
        setData(rosterData);
        setIsAdmin((memberData?.role ?? "") === "Admin");
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCancel = useCallback(
    async (bookingId: number, memberName: string) => {
      if (!confirm(`Cancel ${memberName}'s booking?`)) return;
      setCancelling(bookingId);
      try {
        const res = await fetch("/api/admin/class-bookings/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ occurrence_booking_id: bookingId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Failed to cancel");
        }
        const r = await fetch(`/api/offerings/class-occurrences/${id}/roster`);
        if (r.ok) setData(await r.json());
      } catch (e) {
        alert(e instanceof Error ? e.message : "Failed to cancel");
      } finally {
        setCancelling(null);
      }
    },
    [id]
  );

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return <div className="p-8 text-center text-stone-500">Not found.</div>;

  const name = (m: { first_name: string | null; last_name: string | null }) => [m.first_name, m.last_name].filter(Boolean).join(" ") || "—";

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href="/schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Schedule</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">{data.occurrence.class_name}</h1>
      <p className="text-stone-500 mb-6">{formatDateForDisplay(data.occurrence.occurrence_date)} at {data.occurrence.occurrence_time} {data.occurrence.instructor ? `· ${data.occurrence.instructor}` : ""}</p>
      {isOpenGroupSessionKind(data.occurrence.session_kind) && (
        <p className="mb-6 text-sm rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-950">
          Open Group PT — <strong>${data.occurrence.flat_session_price ?? OPEN_GROUP_DEFAULT_FLAT_PRICE} flat</strong> at the gym for the whole group (not charged online per person).
        </p>
      )}
      <h2 className="font-semibold text-stone-700 mb-2">Who’s Booked ({data.members.length})</h2>
      {data.members.length === 0 ? (
        <p className="text-stone-500">No one has booked yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.members.map((m) => (
            <li key={m.member_id} className="flex flex-wrap justify-between items-center gap-2 py-2 border-b border-stone-100">
              <span className="font-medium text-stone-800 flex flex-wrap items-center gap-2">
                {name(m)}
                {m.booking_role === "organizer" ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 border border-orange-200">
                    Organizer
                  </span>
                ) : m.booking_role === "guest" ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                    Guest
                  </span>
                ) : null}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-stone-500">{m.email ?? "—"}</span>
                <Link href={`/members/${encodeURIComponent(m.member_id)}`} className="text-xs text-brand-600 hover:underline font-medium whitespace-nowrap">
                  Member profile
                </Link>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleCancel(m.booking_id, name(m))}
                    disabled={cancelling === m.booking_id}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancelling === m.booking_id ? "…" : "Cancel booking"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
