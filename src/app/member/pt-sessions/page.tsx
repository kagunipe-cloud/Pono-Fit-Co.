"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPrice, toTitleCase } from "@/lib/format";

type SessionType = { id: number; session_name: string; trainer: string | null; price: string; duration_minutes: number; description: string | null };
type PTSessionTypesResponse = { types: SessionType[]; singleCreditPack: { id: number; price: string } | null };
type PTPack = { id: number; name: string; price: string; credits: number; duration_minutes: number };

export default function MemberPTSessionsPage() {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);
  const [singleCreditPack, setSingleCreditPack] = useState<{ id: number; price: string } | null>(null);
  const [ptPacks, setPtPacks] = useState<PTPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);

  const multiCreditPTPacks = ptPacks.filter((p) => p.credits > 1);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/offerings/pt-session-types").then((r) => r.json()),
      fetch("/api/offerings/pt-pack-products").then((r) => r.json()),
    ])
      .then(([me, data, packsData]: [{ member_id?: string } | null, PTSessionTypesResponse, PTPack[]]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setSessionTypes(Array.isArray(data?.types) ? data.types : []);
        setSingleCreditPack(data?.singleCreditPack ?? null);
        setPtPacks(Array.isArray(packsData) ? packsData : []);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function buyNowScheduleLater(type: SessionType) {
    if (!memberId) return;
    setAddingId(type.id);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "pt_session", product_id: type.id, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
    } finally {
      setAddingId(null);
    }
  }

  async function addPackToCart(pack: PTPack) {
    if (!memberId) return;
    setAddingId(pack.id);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "pt_pack", product_id: pack.id, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
    } finally {
      setAddingId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!memberId) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Browse PT Sessions</h1>
      <p className="text-stone-500 text-sm mb-6">
        Choose a session type below. Book a time now or buy and add to your cart to schedule later.
      </p>
      {multiCreditPTPacks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-0.5">PT Packs</h2>
          <p className="text-sm text-stone-500 mb-4">Bulk Discounts</p>
          <div className="space-y-4">
            {multiCreditPTPacks.map((pack) => (
              <div
                key={pack.id}
                className="p-4 rounded-xl border border-brand-200 bg-brand-50 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <p className="font-medium text-stone-800">{pack.name}</p>
                  <p className="text-sm text-stone-500">
                    {pack.credits} × {pack.duration_minutes} min. Book a time on the schedule or call when you're ready.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addPackToCart(pack)}
                  disabled={addingId !== null}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {addingId === pack.id ? "Adding…" : `${formatPrice(pack.price)} — Add to Cart`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {sessionTypes.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-stone-800 mb-0.5">Current Sessions</h2>
          <p className="text-sm text-stone-500 mb-4">View on Schedule to Book</p>
        </>
      )}
      <ul className="space-y-4">
        {sessionTypes.map((s, i) => (
          <li
            key={`${s.id}-${i}`}
            className="p-4 rounded-xl border border-stone-200 bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-stone-800">{toTitleCase(s.session_name)}</p>
                <p className="text-sm text-stone-500">
                  {s.trainer ? toTitleCase(s.trainer) : "—"} · {formatPrice(s.price)}
                  {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                </p>
                {s.description ? (
                  <p className="text-sm text-stone-600 mt-1">{s.description}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => buyNowScheduleLater(s)}
                  disabled={addingId !== null}
                  className="px-4 py-2 rounded-lg border border-[#5abd78] text-sm font-medium hover:bg-brand-50 disabled:opacity-50"
                  style={{ color: "#5abd78" }}
                >
                  {addingId === s.id ? "Adding…" : "Buy now & schedule later"}
                </button>
                <Link
                  href={`/schedule?product=${s.id}`}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 inline-block"
                >
                  Book now
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {sessionTypes.length === 0 && multiCreditPTPacks.length === 0 && <p className="text-stone-500">No PT session types available yet.</p>}
      <p className="mt-6">
        <Link href="/schedule" className="text-brand-600 hover:underline">Open Schedule →</Link>
        {singleCreditPack && (
          <>
            {" · "}
            <Link href="/member/pt-packs" className="text-brand-600 hover:underline">More PT Packs</Link>
          </>
        )}
        {" · "}
        <Link href="/member/cart" className="text-brand-600 hover:underline">View cart →</Link>
      </p>
    </div>
  );
}
