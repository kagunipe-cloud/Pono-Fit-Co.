"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatDateForDisplay } from "@/lib/app-timezone";

type Member = { booking_id: number; member_id: string; first_name: string | null; last_name: string | null; email: string | null };
type Roster = { occurrence: { class_name: string; occurrence_date: string; occurrence_time: string; instructor: string | null }; members: Member[] };

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
      <h2 className="font-semibold text-stone-700 mb-2">Who’s Booked ({data.members.length})</h2>
      {data.members.length === 0 ? (
        <p className="text-stone-500">No one has booked yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.members.map((m) => (
            <li key={m.member_id} className="flex justify-between items-center py-2 border-b border-stone-100">
              <span className="font-medium text-stone-800">{name(m)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-stone-500">{m.email ?? "—"}</span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleCancel(m.booking_id, name(m))}
                    disabled={cancelling === m.booking_id}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancelling === m.booking_id ? "…" : "Cancel"}
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
