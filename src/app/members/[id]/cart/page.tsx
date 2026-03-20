"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { computeCcFee } from "@/lib/cc-fees";
import { todayInAppTz, weekStartInAppTz, addDaysToDateStr, formatDateForDisplay } from "@/lib/app-timezone";
import { useAppTimezone, useOpenHours } from "@/lib/settings-context";

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
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [readers, setReaders] = useState<{ id: string; label: string; status: string }[]>([]);
  const [selectedReaderId, setSelectedReaderId] = useState("");
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classPacks, setClassPacks] = useState<ClassPack[]>([]);
  const [ptPacks, setPtPacks] = useState<PTPack[]>([]);
  const [addMode, setAddMode] = useState<"membership_plan" | "pt_session" | "class" | "class_pack" | "pt_pack" | null>(null);
  const [saveCardForFuture, setSaveCardForFuture] = useState<boolean | null>(null);
  const [hasSavedCard, setHasSavedCard] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [discount, setDiscount] = useState<{ code: string; percent_off: number; description?: string | null } | null>(null);
  const [canUseTerminal, setCanUseTerminal] = useState(false);
  const [classCredits, setClassCredits] = useState(0);
  const [isOwnCart, setIsOwnCart] = useState(false);
  const [useCreditLoadingId, setUseCreditLoadingId] = useState<number | null>(null);
  const [useCreditConfirm, setUseCreditConfirm] = useState<{ cartItemId: number; occurrenceId: number; itemName: string } | null>(null);
  const [terminalEstimate, setTerminalEstimate] = useState<{
    subtotal: number;
    after_discount: number;
    cc_fee: number;
    tax: number;
    total: number;
  } | null>(null);

  const tz = useAppTimezone();
  const { openHourMin, openHourMax } = useOpenHours();
  const [classScheduleWeekStart, setClassScheduleWeekStart] = useState<string>(() => weekStartInAppTz(todayInAppTz(tz)));
  const [classOccurrences, setClassOccurrences] = useState<ClassOccurrence[]>([]);
  const [classScheduleLoading, setClassScheduleLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        const role = me?.role;
        setCanUseTerminal(role === "Admin" || role === "Trainer");
      })
      .catch(() => setCanUseTerminal(false));
  }, []);

  useEffect(() => {
    if (terminalOpen && memberId && items.length > 0) {
      fetch(`/api/terminal/estimate?member_id=${encodeURIComponent(memberId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d != null ? setTerminalEstimate(d) : setTerminalEstimate(null))
        .catch(() => setTerminalEstimate(null));
    } else {
      setTerminalEstimate(null);
    }
  }, [terminalOpen, memberId, items.length, discount?.code]);

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
        setPromoCode(data.promo_code ?? "");
        setDiscount(data.discount ?? null);
        setClassCredits(data.class_credits ?? 0);
        setIsOwnCart(Boolean(data.is_own_cart));
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
    const min = openHourMin * 60;
    const max = openHourMax * 60;
    const map = new Map<string, ClassOccurrence>();
    for (const o of classOccurrences) {
      const date = o.occurrence_date;
      const startMin = parseTimeToMinutes(o.occurrence_time);
      const duration = o.duration_minutes ?? 60;
      const endMin = startMin + duration;
      for (let slotMin = min; slotMin < max; slotMin += SLOT_MINUTES) {
        if (slotOverlaps(slotMin, startMin, endMin)) {
          const key = `${date}-${slotMin}`;
          if (!map.has(key)) map.set(key, o);
          break;
        }
      }
    }
    return map;
  }, [classOccurrences, openHourMin, openHourMax]);
  const classScheduleTimeSlots = useMemo(() => {
    const min = openHourMin * 60;
    const max = openHourMax * 60;
    const slotSet = new Set<number>();
    for (const o of classOccurrences) {
      const startMin = parseTimeToMinutes(o.occurrence_time);
      const duration = o.duration_minutes ?? 60;
      const endMin = startMin + duration;
      for (let slotMin = min; slotMin < max; slotMin += SLOT_MINUTES) {
        if (slotOverlaps(slotMin, startMin, endMin)) {
          slotSet.add(slotMin);
        }
      }
    }
    return Array.from(slotSet).sort((a, b) => a - b);
  }, [classOccurrences, openHourMin, openHourMax]);


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
      setClassCredits(data.class_credits ?? 0);
    }
  }

  async function useCreditForClass(cartItemId: number, occurrenceId: number) {
    setUseCreditConfirm(null);
    setUseCreditLoadingId(cartItemId);
    try {
      const res = await fetch("/api/class-bookings/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_occurrence_id: occurrenceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not book with credit");
      await fetch(`/api/cart/items/${cartItemId}`, { method: "DELETE" });
      const cartData = await fetch(`/api/members/${id}/cart-data`).then((r) => r.json());
      setItems(cartData.items ?? []);
      setClassCredits(cartData.class_credits ?? 0);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setUseCreditLoadingId(null);
    }
  }

  useEffect(() => {
    if (!terminalOpen) return;
    fetch("/api/terminal/readers")
      .then((r) => r.json())
      .then((data) => {
        const list = data.readers ?? [];
        setReaders(list);
        if (list.length > 0) {
          const online = list.find((r: { status: string }) => r.status === "online");
          setSelectedReaderId(online?.id ?? list[0].id);
        }
      })
      .catch(() => setReaders([]));
  }, [terminalOpen]);

  async function handleTerminalCharge() {
    if (!memberId || !selectedReaderId) return;
    setTerminalLoading(true);
    setTerminalError(null);
    setTerminalStatus("processing");
    try {
      const res = await fetch("/api/terminal/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, reader_id: selectedReaderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start charge");
      const paymentIntentId = data.payment_intent_id;
      if (!paymentIntentId) throw new Error("No payment intent returned");

      const startedAt = Date.now();
      const TIMEOUT_MS = 5 * 60 * 1000; // 5 min — no cancel on reader, customer might walk away
      const poll = async (): Promise<void> => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setTerminalError("Payment timed out. Try again.");
          setTerminalStatus("error");
          setTerminalLoading(false);
          return;
        }
        const statusRes = await fetch(`/api/terminal/payment-status?payment_intent_id=${encodeURIComponent(paymentIntentId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "succeeded") {
          const confirmRes = await fetch("/api/cart/confirm-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_id: memberId, payment_intent_id: paymentIntentId }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) throw new Error(confirmData.error ?? "Failed to confirm");
          setTerminalStatus("success");
          setTerminalLoading(false);
          setTimeout(() => {
            window.location.href = `/members/${id}/cart/success?source=terminal`;
          }, 1500);
          return;
        }
        if (statusData.status === "failed") {
          setTerminalError("Payment canceled");
          setTerminalStatus("error");
          setTerminalLoading(false);
          return;
        }
        // In progress: reader handles its own feedback (declined, insert card, etc.)
        setTimeout(poll, 2000);
      };
      await poll();
    } catch (e) {
      setTerminalError(e instanceof Error ? e.message : "Something went wrong");
      setTerminalStatus("error");
      setTerminalLoading(false);
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

  const subtotal = items.reduce((sum, it) => {
    const p = parseFloat(String(it.price).replace(/[^0-9.-]/g, "")) || 0;
    return sum + (Number.isNaN(p) ? 0 : p) * it.quantity;
  }, 0);
  const discountAmount = discount ? subtotal * (discount.percent_off / 100) : 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const ccFee = computeCcFee(afterDiscount);
  const total = afterDiscount + ccFee;

  async function applyPromoCode() {
    const code = promoCode.trim().toUpperCase();
    if (!code || !memberId) return;
    setPromoError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, promo_code: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      const cartData = await fetch(`/api/members/${id}/cart-data`).then((r) => r.json());
      setDiscount(cartData.discount ?? null);
      setPromoCode(cartData.promo_code ?? code);
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : "Invalid promo code");
    }
  }

  async function removePromoCode() {
    if (!memberId) return;
    setPromoError(null);
    try {
      await fetch("/api/cart", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, promo_code: "" }),
      });
      setDiscount(null);
      setPromoCode("");
    } catch {
      setPromoError("Could not remove code");
    }
  }

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
                {formatDateForDisplay(classScheduleFrom, tz)} – {formatDateForDisplay(classScheduleTo, tz)}
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
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <span className="font-medium text-stone-800">Cart</span>
          {isOwnCart && classCredits > 0 && items.some((it) => it.product_type === "class_occurrence") && (
            <span className="text-sm text-stone-500">{classCredits} credit{classCredits !== 1 ? "s" : ""} available</span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-stone-500 text-sm">Cart is empty. Add a membership, class, or PT session above.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((it) => (
              <li key={it.id} className="p-4 flex justify-between items-center gap-3">
                <span className="flex-1 min-w-0">{it.name} × {it.quantity} — {formatPrice(it.price)}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {it.product_type === "class_occurrence" && isOwnCart && classCredits >= 1 && (
                    <button
                      type="button"
                      onClick={() => setUseCreditConfirm({ cartItemId: it.id, occurrenceId: it.product_id, itemName: it.name })}
                      disabled={useCreditLoadingId === it.id}
                      className="px-2 py-1 rounded text-sm font-medium text-brand-600 hover:bg-brand-50 border border-brand-200 disabled:opacity-50"
                    >
                      {useCreditLoadingId === it.id ? "…" : "Use credit"}
                    </button>
                  )}
                  <button type="button" onClick={() => removeItem(it.id)} className="text-red-600 hover:text-red-700 p-1 rounded" title="Remove" aria-label="Remove item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <>
            {discount && (
              <div className="p-4 border-t border-stone-100 flex justify-between items-center text-green-700">
                <span className="text-sm">
                  Promo <span className="font-mono font-medium">{discount.code}</span> ({discount.percent_off}% off)
                  <button type="button" onClick={removePromoCode} className="ml-2 text-red-600 hover:underline text-xs">Remove</button>
                </span>
                <span>-{formatPrice(discountAmount)}</span>
              </div>
            )}
            {!discount && (
              <div className="p-4 border-t border-stone-100">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoError(null); }}
                    placeholder="Promo code"
                    className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono uppercase"
                  />
                  <button type="button" onClick={applyPromoCode} className="px-3 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 text-sm font-medium">
                    Apply
                  </button>
                </div>
                {promoError && <p className="text-red-600 text-xs mt-1">{promoError}</p>}
              </div>
            )}
            <div className="p-4 border-t border-stone-100 flex justify-between items-center text-sm text-stone-600">
              <span>CC fees (3% + $0.30)</span>
              <span>{formatPrice(ccFee)}</span>
            </div>
            <div className="p-4 border-t border-stone-100 flex justify-between items-center">
              <span className="font-medium">Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </>
        )}
      </div>

      {useCreditConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60"
          onClick={() => { if (useCreditLoadingId !== useCreditConfirm.cartItemId) setUseCreditConfirm(null); }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-stone-800 mb-2">Book with credit</h3>
            <p className="text-stone-600 text-sm mb-3">
              Use 1 credit to book <strong>{useCreditConfirm.itemName}</strong>?
            </p>
            <p className="text-stone-500 text-sm mb-4">
              You have {classCredits} credit{classCredits !== 1 ? "s" : ""} available. This will use 1 of them.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setUseCreditConfirm(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => useCreditForClass(useCreditConfirm.cartItemId, useCreditConfirm.occurrenceId)}
                disabled={useCreditLoadingId === useCreditConfirm.cartItemId}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {useCreditLoadingId === useCreditConfirm.cartItemId ? "Booking…" : "Book with credit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <p className="text-stone-500 text-sm mb-4">
            By paying you agree to our{" "}
            <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link> and{" "}
            <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>.
          </p>
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
            {canUseTerminal && (
              <button
                type="button"
                onClick={() => setTerminalOpen(true)}
                className="px-6 py-3 rounded-lg border-2 border-emerald-600 text-emerald-700 font-medium hover:bg-emerald-50"
              >
                Pay at Front Desk
              </button>
            )}
            <p className="text-stone-500 text-sm self-center">
              You will complete payment on Stripe; then we will activate the membership and notify Kisi for door access.
            </p>
          </div>

          <details className="mt-6 p-6 rounded-xl border-2 border-stone-200 bg-stone-50 open:border-stone-300">
            <summary className="cursor-pointer text-base font-semibold text-stone-800 hover:text-stone-900 list-none [&::-webkit-details-marker]:hidden">
              Having trouble with payment?
            </summary>
            <div className="mt-4 space-y-4 text-base text-stone-600">
              <p>If the payment page doesn&apos;t load or you see a blank screen, try:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>Opening in a different browser (Chrome, Safari, Firefox)</li>
                <li>Using private or incognito mode</li>
                <li>Temporarily disabling ad blockers or privacy extensions</li>
              </ul>
              <div className="pt-3 border-t border-stone-200">
                <p className="font-medium text-stone-800 mb-2">Still having issues? Call or email us to complete your purchase:</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {typeof process.env.NEXT_PUBLIC_CONTACT_PHONE === "string" && process.env.NEXT_PUBLIC_CONTACT_PHONE.trim() ? (
                    <a href={`tel:${process.env.NEXT_PUBLIC_CONTACT_PHONE.replace(/\D/g, "")}`} className="text-brand-600 hover:underline font-medium text-lg">{process.env.NEXT_PUBLIC_CONTACT_PHONE.trim()}</a>
                  ) : null}
                  {typeof process.env.NEXT_PUBLIC_CONTACT_EMAIL === "string" && process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim() ? (
                    <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim()}`} className="text-brand-600 hover:underline font-medium text-lg">{process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim()}</a>
                  ) : null}
                  {(!process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() && !process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()) && (
                    <span>See our website or visit the front desk for contact details.</span>
                  )}
                </div>
              </div>
            </div>
          </details>

          {terminalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60"
              onClick={() => {
                if (!terminalLoading) {
                  setTerminalOpen(false);
                  setTerminalError(null);
                  setTerminalStatus("idle");
                }
              }}
            >
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-stone-800 mb-4">Pay at Front Desk</h3>
                {terminalEstimate != null ? (
                  <div className="mb-4 space-y-1 text-sm">
                    <div className="flex justify-between text-stone-600">
                      <span>Subtotal</span>
                      <span>{formatPrice(terminalEstimate.subtotal)}</span>
                    </div>
                    {terminalEstimate.after_discount < terminalEstimate.subtotal && (
                      <div className="flex justify-between text-green-700">
                        <span>Discount</span>
                        <span>-{formatPrice(terminalEstimate.subtotal - terminalEstimate.after_discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-stone-600">
                      <span>CC fees (3% + $0.30)</span>
                      <span>{formatPrice(terminalEstimate.cc_fee)}</span>
                    </div>
                    {terminalEstimate.tax > 0 && (
                      <div className="flex justify-between text-stone-600">
                        <span>GETax</span>
                        <span>{formatPrice(terminalEstimate.tax)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold text-stone-800 pt-2 border-t border-stone-200">
                      <span>Total</span>
                      <span>{formatPrice(terminalEstimate.total)}</span>
                    </div>
                    <p className="text-stone-500 text-xs pt-1">Customer will pay on the reader.</p>
                  </div>
                ) : (
                  <p className="text-stone-600 text-sm mb-4">
                    Total: {formatPrice(total)} — Customer will pay on the reader.
                  </p>
                )}
                {readers.length === 0 ? (
                  <p className="text-stone-500 text-sm mb-4">Loading readers…</p>
                ) : (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-stone-700 mb-2">Reader</label>
                    <select
                      value={selectedReaderId}
                      onChange={(e) => setSelectedReaderId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                      disabled={terminalLoading}
                    >
                      {readers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label} ({r.status})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {terminalError && <p className="text-red-600 text-sm mb-4">{terminalError}</p>}
                {terminalStatus === "success" && <p className="text-green-600 text-sm mb-4">Payment successful! Redirecting…</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleTerminalCharge}
                    disabled={terminalLoading || readers.length === 0 || !selectedReaderId}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {terminalLoading ? "Processing… Tap card on reader" : "Charge on reader"}
                  </button>
                  {terminalLoading && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await fetch("/api/terminal/cancel-action", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ reader_id: selectedReaderId }),
                          });
                          setTerminalLoading(false);
                          setTerminalError("Payment canceled.");
                          setTerminalStatus("error");
                        } catch {
                          setTerminalError("Failed to cancel.");
                        }
                      }}
                      className="px-4 py-2 rounded-lg border-2 border-amber-500 text-amber-700 font-medium hover:bg-amber-50"
                    >
                      Cancel payment on reader
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setTerminalOpen(false)}
                    disabled={terminalLoading}
                    className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
