"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { todayInAppTz, weekStartInAppTz, addDaysToDateStr, formatInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";

type CartItem = {
  id: number;
  product_type: string;
  product_id: number;
  quantity: number;
  name: string;
  price: string;
};

type Plan = { id: number; plan_name: string; price: string };
type Session = { id: number; session_name: string; price: string };
type ClassPack = { id: number; name: string; price: string; credits: number };
type PTPack = { id: number; name: string; price: string; credits: number; duration_minutes: number };

type ClassOccurrence = {
  id: number;
  class_name: string;
  instructor: string | null;
  occurrence_date: string;
  occurrence_time: string;
  price: string;
  capacity: number;
  booked_count: number;
  duration_minutes?: number;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOT_MIN = 6 * 60;
const TIME_SLOT_MAX = 22 * 60;
const SLOT_MINUTES = 30;

function parseTimeToMinutes(t: string): number {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  return ((parts[0] ?? 0) % 24) * 60 + (parts[1] ?? 0);
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return "12:" + (m < 10 ? "0" : "") + m + " AM";
  if (h < 12) return h + ":" + (m < 10 ? "0" : "") + m + " AM";
  if (h === 12) return "12:" + (m < 10 ? "0" : "") + m + " PM";
  return h - 12 + ":" + (m < 10 ? "0" : "") + m + " PM";
}

function slotOverlaps(slotMin: number, startMin: number, endMin: number): boolean {
  const slotEnd = slotMin + SLOT_MINUTES;
  return startMin < slotEnd && endMin > slotMin;
}

export default function MemberCartPage() {
  const params = useParams();
  const id = params.id as string;
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classPacks, setClassPacks] = useState<ClassPack[]>([]);
  const [ptPacks, setPtPacks] = useState<PTPack[]>([]);
  const [addMode, setAddMode] = useState<"membership_plan" | "pt_session" | "class" | "class_pack" | "pt_pack" | null>(null);
  const [saveCardForFuture, setSaveCardForFuture] = useState<boolean | null>(null);
  const [hasSavedCard, setHasSavedCard] = useState(false);

  const tz = useAppTimezone();
  const [classScheduleWeekStart, setClassScheduleWeekStart] = useState<string>(() => weekStartInAppTz(todayInAppTz(tz)));
  const [classOccurrences, setClassOccurrences] = useState<ClassOccurrence[]>([]);
  const [classScheduleLoading, setClassScheduleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/${id}/cart-data`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMemberId(data.memberId);
        setMemberName(data.memberName ?? "Member");
        setItems(data.items ?? []);
        setPlans(data.plans ?? []);
        setSessions(data.sessions ?? []);
        setClassPacks(data.classPacks ?? []);
        setPtPacks(data.ptPackProducts ?? []);
        setHasSavedCard(Boolean(data.has_saved_card));
        if (data.has_saved_card) setSaveCardForFuture(false);
      })
      .catch(() => {
        if (!cancelled) setMemberId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const classScheduleFrom = classScheduleWeekStart;
  const classScheduleTo = addDaysToDateStr(classScheduleWeekStart, 6);
  useEffect(() => {
    if (addMode !== "class") return;
    setClassScheduleLoading(true);
    fetch(`/api/offerings/class-occurrences?from=${classScheduleFrom}&to=${classScheduleTo}`)
      .then((r) => r.json())
      .then((data) => setClassOccurrences(Array.isArray(data) ? data : []))
      .catch(() => setClassOccurrences([]))
      .finally(() => setClassScheduleLoading(false));
  }, [addMode, classScheduleFrom, classScheduleTo]);

  const classScheduleDayDates = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysToDateStr(classScheduleWeekStart, i)),
    [classScheduleWeekStart]
  );
  const classScheduleGrid = useMemo(() => {
    const map = new Map<string, ClassOccurrence>();
    for (const o of classOccurrences) {
      const date = o.occurrence_date;
      const startMin = parseTimeToMinutes(o.occurrence_time);
      const duration = o.duration_minutes ?? 60;
      const endMin = startMin + duration;
      for (let slotMin = TIME_SLOT_MIN; slotMin < TIME_SLOT_MAX; slotMin += SLOT_MINUTES) {
        if (slotOverlaps(slotMin, startMin, endMin)) {
          const key = `${date}-${slotMin}`;
          if (!map.has(key)) map.set(key, o);
          break;
        }
      }
    }
    return map;
  }, [classOccurrences]);
  const classScheduleTimeSlots = useMemo(() => {
    const slotSet = new Set<number>();
    for (const o of classOccurrences) {
      const startMin = parseTimeToMinutes(o.occurrence_time);
      const duration = o.duration_minutes ?? 60;
      const endMin = startMin + duration;
      for (let slotMin = TIME_SLOT_MIN; slotMin < TIME_SLOT_MAX; slotMin += SLOT_MINUTES) {
        if (slotOverlaps(slotMin, startMin, endMin)) {
          slotSet.add(slotMin);
        }
      }
    }
    return Array.from(slotSet).sort((a, b) => a - b);
  }, [classOccurrences]);


  async function addToCart(product_type: "membership_plan" | "pt_session" | "class" | "class_pack" | "class_occurrence" | "pt_pack", product_id: number) {
    if (!memberId) return;
    const res = await fetch("/api/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, product_type, product_id, quantity: 1 }),
    });
    if (res.ok) {
      const data = await fetch(`/api/members/${id}/cart-data`).then((r) => r.json());
      setItems(data.items ?? []);
      setAddMode(null);
    }
  }

  async function removeItem(itemId: number) {
    await fetch(`/api/cart/items/${itemId}`, { method: "DELETE" });
    if (memberId && id) {
      const data = await fetch(`/api/members/${id}/cart-data`).then((r) => r.json());
      setItems(data.items ?? []);
    }
  }

  async function goToStripeCheckout() {
    if (!memberId || items.length === 0) return;
    if (!hasSavedCard && saveCardForFuture === null) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/cart/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, save_card_for_future: saveCardForFuture === true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCheckoutLoading(false);
    }
  }

  const total = items.reduce((sum, it) => {
    const p = parseFloat(String(it.price).replace(/[^0-9.-]/g, "")) || 0;
    return sum + (Number.isNaN(p) ? 0 : p) * it.quantity;
  }, 0);

  if (loading && !memberId) return <div className="p-12 text-center text-stone-500">Loading…</div>;
  if (!memberId) return <div className="p-12 text-center text-red-600">Member not found.</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link href={`/members/${id}`} className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to member</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Cart for {memberName}</h1>
      <p className="text-stone-500 text-sm mb-6">Add membership, class, or PT session. Click Pay with Stripe to complete payment; when payment succeeds, we’ll activate the membership and notify Kisi for door access.</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAddMode(addMode === "membership_plan" ? null : "membership_plan")}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add membership
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "pt_session" ? null : "pt_session")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add PT session
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "class" ? null : "class")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add class
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "class_pack" ? null : "class_pack")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add class pack
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "pt_pack" ? null : "pt_pack")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add PT pack
        </button>
      </div>

      {addMode === "membership_plan" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a plan</p>
          <ul className="space-y-1">
            {plans.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("membership_plan", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.plan_name} — {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {plans.length === 0 && <li className="text-stone-600 text-sm">No plans. Add some in Membership plans.</li>}
          </ul>
        </div>
      )}
      {addMode === "pt_session" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a PT session</p>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => addToCart("pt_session", s.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {s.session_name} — {formatPrice(s.price)}
                </button>
              </li>
            ))}
            {sessions.length === 0 && <li className="text-stone-600 text-sm">No PT sessions.</li>}
          </ul>
        </div>
      )}
      {addMode === "class" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60" onClick={() => setAddMode(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-800">Add class — pick a time</h2>
              <button type="button" onClick={() => setAddMode(null)} className="p-2 rounded-lg text-stone-500 hover:bg-stone-100" aria-label="Close">×</button>
            </div>
            <div className="p-3 border-b border-stone-100 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setClassScheduleWeekStart((s) => addDaysToDateStr(s, -7))} className="px-2 py-1 rounded border border-stone-200 text-sm hover:bg-stone-50">← Prev</button>
              <button type="button" onClick={() => setClassScheduleWeekStart(weekStartInAppTz(todayInAppTz(tz)))} className="px-2 py-1 rounded border border-stone-200 text-sm hover:bg-stone-50">Today</button>
              <button type="button" onClick={() => setClassScheduleWeekStart((s) => addDaysToDateStr(s, 7))} className="px-2 py-1 rounded border border-stone-200 text-sm hover:bg-stone-50">Next →</button>
              <span className="text-sm text-stone-500 ml-2">
                {formatInAppTz(new Date(classScheduleFrom + "T12:00:00Z"), { month: "short", day: "numeric", year: "numeric" }, tz)} – {formatInAppTz(new Date(classScheduleTo + "T12:00:00Z"), { month: "short", day: "numeric", year: "numeric" }, tz)}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {classScheduleLoading ? (
                <p className="text-center text-stone-500 py-8">Loading schedule…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" style={{ minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th className="w-14 py-1.5 px-1 text-left text-xs font-medium text-stone-500 border-b border-r border-stone-200 bg-stone-50">Time</th>
                        {DAY_NAMES.map((name, i) => (
                          <th key={name} className="py-1.5 px-1 text-center text-xs font-medium text-stone-600 border-b border-r border-stone-200 bg-stone-50 last:border-r-0">
                            {name} {parseInt(classScheduleDayDates[i].slice(8, 10), 10)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {classScheduleTimeSlots.map((slotMin) => (
                        <tr key={slotMin} className="border-b border-stone-100 last:border-b-0">
                          <td className="py-0.5 px-1 text-xs text-stone-500 border-r border-stone-200 whitespace-nowrap">{formatTime(slotMin)}</td>
                          {classScheduleDayDates.map((date) => {
                            const key = `${date}-${slotMin}`;
                            const occ = classScheduleGrid.get(key);
                            return (
                              <td key={date} className="align-top p-0.5 min-w-[100px] border-r border-stone-100 last:border-r-0">
                                {occ ? (
                                  <button
                                    type="button"
                                    onClick={() => addToCart("class_occurrence", occ.id)}
                                    className="w-full text-left rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 hover:bg-blue-100 hover:border-blue-300 transition-colors"
                                  >
                                    <span className="font-medium text-stone-800 block truncate" title={occ.class_name}>{occ.class_name}</span>
                                    {occ.instructor && <span className="text-xs text-stone-500 block truncate">{occ.instructor}</span>}
                                    <span className="text-xs text-stone-600">{formatPrice(occ.price)}</span>
                                  </button>
                                ) : (
                                  <div className="min-h-[2rem]" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!classScheduleLoading && classOccurrences.length === 0 && (
                <p className="text-center text-stone-500 py-6">No classes this week. Try another week.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {addMode === "class_pack" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a class pack</p>
          <ul className="space-y-1">
            {classPacks.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("class_pack", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.name} — {p.credits} credits · {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {classPacks.length === 0 && <li className="text-stone-600 text-sm">No class packs. Add some in Class packs.</li>}
          </ul>
        </div>
      )}
      {addMode === "pt_pack" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a PT pack</p>
          <ul className="space-y-1">
            {ptPacks.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("pt_pack", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.name} — {p.credits}×{p.duration_minutes} min · {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {ptPacks.length === 0 && <li className="text-stone-600 text-sm">No PT packs. Add some in PT packs.</li>}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden mb-6">
        <div className="p-4 border-b border-stone-100 font-medium text-stone-800">Cart</div>
        {items.length === 0 ? (
          <p className="p-6 text-stone-500 text-sm">Cart is empty. Add a membership, class, or PT session above.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((it) => (
              <li key={it.id} className="p-4 flex justify-between items-center">
                <span>{it.name} × {it.quantity} — {formatPrice(it.price)}</span>
                <button type="button" onClick={() => removeItem(it.id)} className="text-red-600 hover:text-red-700 p-1 rounded" title="Remove" aria-label="Remove item">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <div className="p-4 border-t border-stone-100 flex justify-between items-center">
            <span className="font-medium">Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <>
          {!hasSavedCard && (
            <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-white">
              <p className="text-sm font-medium text-stone-800 mb-2">Use this card for future payments?</p>
              <p className="text-stone-500 text-xs mb-3">We will use the card on file to auto-charge your membership on the next billing date. You must choose one before paying.</p>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="save_card"
                    checked={saveCardForFuture === true}
                    onChange={() => setSaveCardForFuture(true)}
                    className="text-brand-600"
                  />
                  <span className="text-sm font-medium">Yes — save for renewals</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="save_card"
                    checked={saveCardForFuture === false}
                    onChange={() => setSaveCardForFuture(false)}
                    className="text-brand-600"
                  />
                  <span className="text-sm font-medium">No — one-time only</span>
                </label>
              </div>
              {saveCardForFuture === null && (
                <p className="text-brand-600 text-xs mt-2">Please select Yes or No above.</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={goToStripeCheckout}
              disabled={checkoutLoading || (!hasSavedCard && saveCardForFuture === null)}
              className="px-6 py-3 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {checkoutLoading ? "Redirecting to Stripe…" : "Pay with Stripe"}
            </button>
            <p className="text-stone-500 text-sm self-center">
              You will complete payment on Stripe; then we will activate the membership and notify Kisi for door access.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
