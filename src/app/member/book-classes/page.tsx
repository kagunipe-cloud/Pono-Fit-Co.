"use client";

import { Suspense, useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateForDisplay } from "@/lib/app-timezone";
import {
  isOpenGroupSessionKind,
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
} from "@/lib/open-group-pt";

type Occurrence = {
  id: number;
  class_name: string;
  instructor: string | null;
  occurrence_date: string;
  occurrence_time: string;
  booked_count: number;
  capacity: number;
  price: string;
  session_kind?: string;
  flat_session_price?: string | null;
};

type OgStatus = {
  my_role: string | null;
  share_url?: string;
  booked_count?: number;
};

function MemberBookClassesContent() {
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
  const [ogReserveLoadingId, setOgReserveLoadingId] = useState<number | null>(null);
  const [ogStatusByOcc, setOgStatusByOcc] = useState<Record<number, OgStatus>>({});

  const reloadOccurrences = useCallback(async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 28);
      return d.toISOString().slice(0, 10);
    })();
    if (highlightId) {
      const r = await fetch(`/api/offerings/class-occurrences/${highlightId}`);
      const occ = r.ok ? await r.json() : null;
      setOccurrences(occ && !Array.isArray(occ) ? [occ as Occurrence] : []);
    } else {
      const r = await fetch(`/api/offerings/class-occurrences?from=${from}&to=${to}`);
      const list = r.ok ? await r.json() : [];
      setOccurrences(Array.isArray(list) ? list : []);
    }
  }, [highlightId]);

  useEffect(() => {
    const from = new Date().toISOString().slice(0, 10);
    const to = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 28);
      return d.toISOString().slice(0, 10);
    })();
    const fetches = highlightId
      ? [
          fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/member/class-credits").then((r) => (r.ok ? r.json() : { balance: 0 })),
          fetch(`/api/offerings/class-occurrences/${highlightId}`).then((r) => (r.ok ? r.json() : null)),
        ]
      : [
          fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/member/class-credits").then((r) => (r.ok ? r.json() : { balance: 0 })),
          fetch(`/api/offerings/class-occurrences?from=${from}&to=${to}`).then((r) => r.json()),
        ];
    Promise.all(fetches)
      .then(([me, cred, occ]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setCredits(cred.balance ?? 0);
        setOccurrences(highlightId && occ && !Array.isArray(occ) ? [occ as Occurrence] : Array.isArray(occ) ? occ : []);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router, highlightId]);

  const refreshOgStatus = useCallback(async (occurrenceId: number) => {
    const r = await fetch(`/api/member/open-group-pt/status?occurrence_id=${occurrenceId}`);
    if (!r.ok) return;
    const j = (await r.json()) as {
      my_role?: string | null;
      share_url?: string;
      booked_count?: number;
    };
    setOgStatusByOcc((prev) => ({
      ...prev,
      [occurrenceId]: {
        my_role: j.my_role ?? null,
        share_url: j.share_url,
        booked_count: j.booked_count,
      },
    }));
  }, []);

  useEffect(() => {
    if (!memberId || occurrences.length === 0) return;
    for (const o of occurrences) {
      if (isOpenGroupSessionKind(o.session_kind)) void refreshOgStatus(o.id);
    }
  }, [memberId, occurrences, refreshOgStatus]);

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
        await reloadOccurrences();
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

  async function reserveOpenGroup(occurrenceId: number, inviteToken?: string) {
    setOgReserveLoadingId(occurrenceId);
    try {
      const res = await fetch("/api/class-bookings/book-open-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_occurrence_id: occurrenceId,
          ...(inviteToken ? { invite_token: inviteToken } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await reloadOccurrences();
        await refreshOgStatus(occurrenceId);
        if (typeof data.share_url === "string" && data.share_url) {
          window.alert(`Invite up to 3 friends with this link (they'll need to log in):\n\n${data.share_url}`);
        }
      } else {
        alert(data.error ?? "Could not complete reservation");
      }
    } finally {
      setOgReserveLoadingId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  const formatPrice = (p: string) => {
    const n = parseFloat(String(p));
    if (Number.isNaN(n) || n === 0) return "Free";
    return `$${n.toFixed(2)}`;
  };

  const deskFlat = (o: Occurrence) => o.flat_session_price ?? OPEN_GROUP_DEFAULT_FLAT_PRICE;

  return (
    <div className="max-w-2xl mx-auto p-6">
      {highlightId && (
        <Link href="/schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
          ← Back to schedule
        </Link>
      )}
      <h1 className="text-2xl font-bold text-stone-800 mb-2">{highlightId ? "Book this class" : "Book a Class"}</h1>
      <p className="text-stone-600 mb-6">
        Pay for a single class or use a class credit — except <strong>Open Group Personal Training</strong> (flat fee at the gym).
        You have <strong>{credits ?? 0} class credits</strong>.{" "}
        <Link href="/member/class-packs" className="text-brand-600 hover:underline">
          Class packs
        </Link>
      </p>
      {credits !== null && credits < 1 && (
        <p className="mb-6 p-4 rounded-lg bg-amber-50 text-amber-800 text-sm">
          No credits. <Link href="/member/class-packs" className="underline">Buy a class pack</Link> to use credits, or pay per class below (Open Group PT uses the orange schedule flow).
        </p>
      )}
      <ul className="space-y-4">
        {occurrences.map((o) => {
          const og = isOpenGroupSessionKind(o.session_kind);
          const st = ogStatusByOcc[o.id];
          const bookedDisplay = st?.booked_count ?? o.booked_count;
          return (
            <li
              key={o.id}
              ref={(el) => {
                refMap.current[o.id] = el;
              }}
              className={`p-4 rounded-xl border bg-white flex flex-col gap-3 ${highlightId === o.id ? "border-brand-400 ring-2 ring-brand-200" : "border-stone-200"} ${og ? "border-orange-200 bg-orange-50/40" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-800 flex flex-wrap items-center gap-2">
                    {o.class_name}
                    {og ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-200 text-orange-900 border border-orange-300">
                        Open Group PT
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-stone-500">
                    {formatDateForDisplay(o.occurrence_date)} at {o.occurrence_time} · {o.instructor ?? "—"} ·{" "}
                    {bookedDisplay}/{o.capacity} booked
                    {!og ? <> · {formatPrice(o.price ?? "0")}</> : null}
                  </p>
                </div>
              </div>

              {og ? (
                <div className="space-y-3 text-sm text-stone-700">
                  <p>
                    <strong>${deskFlat(o)} total at the gym</strong> for everyone in your group (however many show up, up to{" "}
                    {o.capacity}). Signing up here is free; only the organizer can reserve an empty slot, then shares an invite link.
                  </p>
                  {st?.my_role === "organizer" && st.share_url ? (
                    <div className="rounded-lg border border-orange-200 bg-white p-3 space-y-2">
                      <span className="text-xs font-medium text-orange-900">Invite friends (max {Math.max(0, o.capacity - 1)})</span>
                      <input readOnly className="w-full text-xs font-mono px-2 py-2 rounded border border-stone-200 bg-stone-50" value={st.share_url} />
                      <button
                        type="button"
                        className="text-sm text-orange-700 font-medium hover:underline"
                        onClick={() => navigator.clipboard.writeText(st.share_url!).catch(() => {})}
                      >
                        Copy invite link
                      </button>
                    </div>
                  ) : null}
                  {st?.my_role === "guest" ? (
                    <p className="text-emerald-800 font-medium">
                      You&apos;re booked in this group. Remind everyone: ${deskFlat(o)} total at the desk.
                    </p>
                  ) : null}
                  {bookedDisplay === 0 ? (
                    <button
                      type="button"
                      onClick={() => reserveOpenGroup(o.id)}
                      disabled={ogReserveLoadingId === o.id}
                      className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                    >
                      {ogReserveLoadingId === o.id ? "Saving…" : "Reserve slot & start group"}
                    </button>
                  ) : !st?.my_role ? (
                    <p className="text-stone-600">
                      This time is already reserved. Ask the organizer for the invite link, or{" "}
                      <Link href={`/member/open-group-pt/join?occurrence_id=${o.id}`} className="text-orange-700 font-medium underline">
                        open the join page
                      </Link>{" "}
                      and paste the token from their link.
                    </p>
                  ) : null}
                </div>
              ) : (
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
              )}
            </li>
          );
        })}
      </ul>
      {occurrences.length === 0 && <p className="text-stone-500">No upcoming classes in the next 4 weeks.</p>}
      <p className="mt-6 flex flex-wrap gap-4">
        <Link href="/member/cart" className="text-brand-600 hover:underline">
          Cart →
        </Link>
        <Link href="/member/class-bookings" className="text-brand-600 hover:underline">
          My class bookings →
        </Link>
        <Link href="/schedule" className="text-orange-700 hover:underline font-medium">
          Schedule
        </Link>
      </p>
    </div>
  );
}

export default function MemberBookClassesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <MemberBookClassesContent />
    </Suspense>
  );
}
