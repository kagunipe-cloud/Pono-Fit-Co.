"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Roster = { occurrence: { class_name: string; occurrence_date: string; occurrence_time: string; instructor: string | null }; members: { member_id: string; first_name: string | null; last_name: string | null; email: string | null }[] };

export default function RosterPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/offerings/class-occurrences/${id}/roster`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return <div className="p-8 text-center text-stone-500">Not found.</div>;

  const name = (m: { first_name: string | null; last_name: string | null }) => [m.first_name, m.last_name].filter(Boolean).join(" ") || "—";

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href="/schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Schedule</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">{data.occurrence.class_name}</h1>
      <p className="text-stone-500 mb-6">{data.occurrence.occurrence_date} at {data.occurrence.occurrence_time} {data.occurrence.instructor ? `· ${data.occurrence.instructor}` : ""}</p>
      <h2 className="font-semibold text-stone-700 mb-2">Who’s Booked ({data.members.length})</h2>
      {data.members.length === 0 ? (
        <p className="text-stone-500">No one has booked yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.members.map((m) => (
            <li key={m.member_id} className="flex justify-between items-center py-2 border-b border-stone-100">
              <span className="font-medium text-stone-800">{name(m)}</span>
              <span className="text-sm text-stone-500">{m.email ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
