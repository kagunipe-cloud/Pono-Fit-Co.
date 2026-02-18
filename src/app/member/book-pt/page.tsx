"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return "12:" + (m < 10 ? "0" : "") + m + " AM";
  if (h < 12) return h + ":" + (m < 10 ? "0" : "") + m + " AM";
  if (h === 12) return "12:" + (m < 10 ? "0" : "") + m + " PM";
  return h - 12 + ":" + (m < 10 ? "0" : "") + m + " PM";
}

function normalizeTimeToHHmm(t: string): string {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = (parts[0] ?? 0) % 24;
  const m = Math.min(59, Math.max(0, parts[1] ?? 0));
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

type PtSessionProduct = { id: number; session_name: string; duration_minutes: number; price: string; trainer: string | null };

export default function MemberBookPTPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightDate = searchParams.get("date")?.trim() || null;
  const highlightTime = searchParams.get("time")?.trim() || null;
  const slotFromSchedule = highlightDate && highlightTime;

  const productFromUrl = searchParams.get("product")?.trim() || null;
  const productIdFromUrl = productFromUrl ? parseInt(productFromUrl, 10) : null;

  const [memberId, setMemberId] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<number, number>>({ 30: 0, 60: 0, 90: 0 });
  const [sessionProducts, setSessionProducts] = useState<PtSessionProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [slotBookingInProgress, setSlotBookingInProgress] = useState(false);
  const [slotAddToCartInProgress, setSlotAddToCartInProgress] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/member/pt-credits").then((r) => (r.ok ? r.json() : { 30: 0, 60: 0, 90: 0 })),
    ])
      .then(([me, cred]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setCredits(cred ?? { 30: 0, 60: 0, 90: 0 });
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    fetch("/api/offerings/pt-session-products")
      .then((r) => r.json())
        .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setSessionProducts(list);
        if (list.length > 0) {
          const match = productIdFromUrl && list.some((p: PtSessionProduct) => p.id === productIdFromUrl)
            ? productIdFromUrl
            : list[0].id;
          setSelectedProductId(match);
        }
      })
      .catch(() => setSessionProducts([]));
  }, []);

  const slotProduct = useMemo(
    () => (selectedProductId != null ? sessionProducts.find((p) => p.id === selectedProductId) ?? null : null),
    [sessionProducts, selectedProductId]
  );

  async function submitSlotWithCredit() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId || !slotProduct) return;
    const start_time = normalizeTimeToHHmm(highlightTime);
    setSlotBookingInProgress(true);
    try {
      const res = await fetch("/api/pt-bookings/book-open-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          occurrence_date: highlightDate,
          start_time,
          duration_minutes: slotProduct.duration_minutes,
          pt_session_id: slotProduct.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCredits((c) => ({ ...c, [slotProduct.duration_minutes]: data.balance ?? Math.max(0, (c[slotProduct.duration_minutes] ?? 1) - 1) }));
        router.push("/schedule");
      } else {
        alert(data.error ?? "Booking failed");
      }
    } finally {
      setSlotBookingInProgress(false);
    }
  }

  async function addSlotToCart() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId || !slotProduct) return;
    const start_time = normalizeTimeToHHmm(highlightTime);
    setSlotAddToCartInProgress(true);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          product_type: "pt_session",
          product_id: slotProduct.id,
          quantity: 1,
          slot: { date: highlightDate, start_time, duration_minutes: slotProduct.duration_minutes },
        }),
      });
      if (res.ok) router.push("/member/cart");
      else {
        const data = await res.json();
        alert(data.error ?? "Failed to add to cart");
      }
    } finally {
      setSlotAddToCartInProgress(false);
    }
  }

  if (!memberId) return null;

  const slotTimeDisplay = highlightTime
    ? (() => {
        const parts = String(highlightTime).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
        const h = (parts[0] ?? 0) % 24;
        const m = Math.min(59, Math.max(0, parts[1] ?? 0));
        const min = h * 60 + m;
        return formatTime(min);
      })()
    : "";

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Book PT</h1>

      {slotFromSchedule && highlightDate ? (
        <div className="mb-6 p-4 rounded-xl border-2 border-brand-200 bg-brand-50">
          <h2 className="font-semibold text-stone-800 mb-2">Book This Slot</h2>
          <p className="text-sm text-stone-600 mb-3">
            {highlightDate} at {slotTimeDisplay}
          </p>
          <div className="mb-3">
            <label className="block text-sm font-medium text-stone-700 mb-1">Session</label>
            <select
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(parseInt(e.target.value, 10) || null)}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-stone-200"
            >
              {sessionProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.session_name}
                  {p.trainer ? ` — ${p.trainer}` : ""} · {p.duration_minutes} min · ${p.price}
                </option>
              ))}
            </select>
            {slotProduct && (
              <p className="text-xs text-stone-500 mt-1">
                {slotProduct.duration_minutes} min · blocks this time on the schedule
              </p>
            )}
          </div>
          {slotProduct ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-stone-700">
                {slotProduct.session_name} — ${slotProduct.price}
              </span>
              <button
                type="button"
                onClick={submitSlotWithCredit}
                disabled={slotBookingInProgress || (credits[slotProduct.duration_minutes] ?? 0) < 1}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {slotBookingInProgress ? "Booking…" : `Use 1 credit (${slotProduct.duration_minutes} min)`}
              </button>
              <button
                type="button"
                onClick={addSlotToCart}
                disabled={slotAddToCartInProgress}
                className="px-4 py-2 rounded-lg border border-stone-200 bg-white text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              >
                {slotAddToCartInProgress ? "Adding…" : `Add to cart ($${slotProduct.price})`}
              </button>
            </div>
          ) : (
            <p className="text-sm text-amber-600">
              No bookable PT session type. Members can only book when staff add a <strong>PT session with no date/time</strong> (a template) on the PT Sessions page — e.g. &quot;60 min PT&quot;. <Link href="/schedule" className="underline">Back to schedule</Link> or ask staff to add one.
            </p>
          )}
          {slotProduct && (credits[slotProduct.duration_minutes] ?? 0) < 1 && (
            <p className="text-xs text-stone-500 mt-2">No {slotProduct.duration_minutes}-min credit? Add to cart to pay instead.</p>
          )}
        </div>
      ) : (
        <p className="text-stone-600 mb-6">
          Pick an{" "}
          <Link
            href={selectedProductId != null ? `/schedule?product=${selectedProductId}` : "/schedule"}
            className="text-brand-600 hover:underline font-medium"
          >
            available time on the Schedule
          </Link>{" "}
          to book a PT session. You have <strong>{credits[30]}×30min</strong>, <strong>{credits[60]}×60min</strong>, <strong>{credits[90]}×90min</strong> credits.
        </p>
      )}

      <p className="text-sm text-stone-500 mb-6">
        <Link href={selectedProductId != null ? `/schedule?product=${selectedProductId}` : "/schedule"} className="text-brand-600 hover:underline">Schedule</Link>
        {" · "}
        <Link href="/member/pt-packs" className="text-brand-600 hover:underline">Buy PT packs</Link>
      </p>

      <p className="mt-6">
        <Link href="/member/cart" className="text-brand-600 hover:underline">Cart</Link>
        {" · "}
        <Link href="/member/pt-bookings" className="text-brand-600 hover:underline">My PT bookings</Link>
      </p>
    </div>
  );
}
