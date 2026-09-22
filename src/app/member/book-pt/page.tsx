"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  OPEN_GROUP_HOURLY_RATE,
  OPEN_GROUP_MAX_PARTICIPANTS,
  smallGroupPtPriceSummary,
  type SmallGroupPtHours,
} from "@/lib/open-group-pt";
import { SameDaySchedulingNotice } from "@/components/SameDaySchedulingNotice";
import { isSameDayAppointment } from "@/lib/same-day-scheduling";
import { memberPhoneOnFile, normalizeMemberPhoneInput } from "@/lib/member-phone";
import {
  FIRST_TIME_PT_INFO_MESSAGE,
  FIRST_TIME_PT_MIN_DURATION_MINUTES,
  FIRST_TIME_PT_SHORT_SESSION_NO_STACK_MESSAGE,
  FIRST_TIME_PT_STACK_30_PROMPT,
  firstTimePtDurationTooShort,
  memberCanStackTwoThirtyCredits,
} from "@/lib/first-time-pt-booking";
import { useAppTimezone } from "@/lib/settings-context";

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
type TrainerOption = { member_id: string; display_name: string };
type SlotBookingKind = "pt" | "small_group_pt";

function MemberBookPTContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tz = useAppTimezone();
  const highlightDate = searchParams.get("date")?.trim() || null;
  const highlightTime = searchParams.get("time")?.trim() || null;
  const block = searchParams.get("block")?.trim() || null;
  const slotFromSchedule = highlightDate && highlightTime;
  const sameDaySlotFromSchedule = !!(slotFromSchedule && highlightDate && isSameDayAppointment(highlightDate, tz));
  const selectedTrainerNameFromUrl = searchParams.get("trainer_name")?.trim() || null;
  const selectedTrainerIdFromUrl = searchParams.get("trainer")?.trim() || null;

  const productFromUrl = searchParams.get("product")?.trim() || null;
  const productIdFromUrl = productFromUrl ? parseInt(productFromUrl, 10) : null;

  const [memberId, setMemberId] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<number, number>>({});
  const [sessionProducts, setSessionProducts] = useState<PtSessionProduct[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [slotBookingKind, setSlotBookingKind] = useState<SlotBookingKind>("pt");
  const [smallGroupHours, setSmallGroupHours] = useState<SmallGroupPtHours>(1);
  const [slotBookingInProgress, setSlotBookingInProgress] = useState(false);
  const [stackBookingInProgress, setStackBookingInProgress] = useState(false);
  const [slotAddToCartInProgress, setSlotAddToCartInProgress] = useState(false);
  const [smallGroupReserveInProgress, setSmallGroupReserveInProgress] = useState(false);
  const [memberPhone, setMemberPhone] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [isFirstTimePtBooker, setIsFirstTimePtBooker] = useState<boolean | null>(null);

  const needsPhone = memberPhone !== null && !memberPhoneOnFile(memberPhone);

  useEffect(() => {
    fetch("/api/trainers")
      .then((r) => r.json())
      .then((data: TrainerOption[]) => setTrainers(Array.isArray(data) ? data : []))
      .catch(() => setTrainers([]));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/member/pt-credits").then((r) => (r.ok ? r.json() : {})),
      fetch("/api/member/phone").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/member/pt-booking-eligibility").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, cred, phoneData, eligibility]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setCredits(cred && typeof cred === "object" ? (cred as Record<number, number>) : {});
        const phone = typeof phoneData?.phone === "string" ? phoneData.phone : "";
        setMemberPhone(phone);
        if (!memberPhoneOnFile(phone)) setPhoneInput(phone);
        setIsFirstTimePtBooker(eligibility?.is_first_time_pt_booker === true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function ensurePhoneOnFile(): Promise<boolean> {
    if (!needsPhone) return true;
    const parsed = normalizeMemberPhoneInput(phoneInput);
    if (!parsed.ok) {
      alert(parsed.message);
      return false;
    }
    setPhoneSaving(true);
    try {
      const res = await fetch("/api/member/phone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: parsed.value }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Could not save phone number");
        return false;
      }
      setMemberPhone(parsed.value);
      return true;
    } finally {
      setPhoneSaving(false);
    }
  }

  useEffect(() => {
    fetch("/api/offerings/pt-session-products")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setSessionProducts(list);
        if (list.length > 0) {
          const hourProducts = list.filter((p: PtSessionProduct) => p.duration_minutes >= FIRST_TIME_PT_MIN_DURATION_MINUTES);
          const byProductUrl =
            productIdFromUrl && list.some((p: PtSessionProduct) => p.id === productIdFromUrl) ? productIdFromUrl : null;
          const byTrainer = selectedTrainerNameFromUrl
            ? list.find((p: PtSessionProduct) => (p.trainer ?? "").trim() === selectedTrainerNameFromUrl.trim())?.id
            : null;
          const defaultPool =
            isFirstTimePtBooker && hourProducts.length > 0 ? hourProducts : list;
          setSelectedProductId(byProductUrl ?? byTrainer ?? defaultPool[0].id);
        }
      })
      .catch(() => setSessionProducts([]));
  }, [selectedTrainerNameFromUrl, productIdFromUrl, isFirstTimePtBooker]);

  const slotProduct = useMemo(
    () => (selectedProductId != null ? sessionProducts.find((p) => p.id === selectedProductId) ?? null : null),
    [sessionProducts, selectedProductId]
  );

  const firstTimeShortSessionSelected =
    isFirstTimePtBooker === true &&
    slotBookingKind === "pt" &&
    slotProduct != null &&
    firstTimePtDurationTooShort(slotProduct.duration_minutes);

  const canStackTwoThirty =
    firstTimeShortSessionSelected && memberCanStackTwoThirtyCredits(credits[30] ?? 0);

  const firstTimeNeedsHour = firstTimeShortSessionSelected && !canStackTwoThirty;

  const ptCreditsSummary = useMemo(() => {
    const parts = Object.entries(credits)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([mins, n]) => `${n}×${mins} min`);
    return parts.length ? parts.join(", ") : "no PT credits yet";
  }, [credits]);

  const [slotFree, setSlotFree] = useState<boolean | null>(null);
  useEffect(() => {
    if (!slotFromSchedule || !highlightDate || !highlightTime) {
      setSlotFree(null);
      return;
    }
    const start_time = normalizeTimeToHHmm(highlightTime);
    const duration_minutes =
      slotBookingKind === "small_group_pt"
        ? smallGroupHours * 60
        : canStackTwoThirty
          ? FIRST_TIME_PT_MIN_DURATION_MINUTES
          : slotProduct?.duration_minutes;
    if (!duration_minutes) {
      setSlotFree(null);
      return;
    }
    const params = new URLSearchParams({
      date: highlightDate,
      time: start_time,
      duration_minutes: String(duration_minutes),
    });
    if (slotBookingKind === "pt" && slotProduct) {
      params.set("pt_session_id", String(slotProduct.id));
    }
    if (selectedTrainerIdFromUrl) params.set("trainer_member_id", selectedTrainerIdFromUrl);
    fetch(`/api/pt-bookings/check-open-slot?${params}`)
      .then((r) => r.json())
      .then((data: { free?: boolean }) => setSlotFree(data.free === true))
      .catch(() => setSlotFree(null));
  }, [slotFromSchedule, highlightDate, highlightTime, slotProduct, selectedTrainerIdFromUrl, slotBookingKind, smallGroupHours, canStackTwoThirty]);

  async function submitStackTwoThirtyCredits() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId || !slotProduct || slotProduct.duration_minutes !== 30) return;
    if (!(await ensurePhoneOnFile())) return;
    const start_time = normalizeTimeToHHmm(highlightTime);
    setStackBookingInProgress(true);
    try {
      let res: Response;
      if (block) {
        const blockId = parseInt(block, 10);
        if (Number.isNaN(blockId)) {
          alert("Invalid slot. Please try again from the schedule.");
          return;
        }
        res = await fetch("/api/pt-bookings/book-trainer-specific", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainer_availability_id: blockId,
            occurrence_date: highlightDate,
            start_time,
            session_duration_minutes: slotProduct.duration_minutes,
            member_id: memberId,
            use_credit: true,
            first_time_stack_30_credits: true,
          }),
        });
      } else {
        res = await fetch("/api/pt-bookings/book-open-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: memberId,
            occurrence_date: highlightDate,
            start_time,
            duration_minutes: slotProduct.duration_minutes,
            pt_session_id: slotProduct.id,
            first_time_stack_30_credits: true,
          }),
        });
      }
      const data = await res.json();
      if (res.ok) {
        setCredits((c) => ({
          ...c,
          30: data.balance ?? Math.max(0, (c[30] ?? 2) - 2),
        }));
        router.push("/schedule");
      } else {
        alert(data.error ?? "Booking failed");
      }
    } finally {
      setStackBookingInProgress(false);
    }
  }

  async function submitSlotWithCredit() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId || !slotProduct) return;
    if (!(await ensurePhoneOnFile())) return;
    const start_time = normalizeTimeToHHmm(highlightTime);
    setSlotBookingInProgress(true);
    try {
      let res: Response;
      if (block) {
        const blockId = parseInt(block, 10);
        if (Number.isNaN(blockId)) {
          alert("Invalid slot. Please try again from the schedule.");
          return;
        }
        res = await fetch("/api/pt-bookings/book-trainer-specific", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainer_availability_id: blockId,
            occurrence_date: highlightDate,
            start_time,
            session_duration_minutes: slotProduct.duration_minutes,
            member_id: memberId,
            use_credit: true,
          }),
        });
      } else {
        res = await fetch("/api/pt-bookings/book-open-slot", {
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
      }
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

  async function reserveSmallGroupPt() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId) return;
    if (!(await ensurePhoneOnFile())) return;
    const start_time = normalizeTimeToHHmm(highlightTime);
    setSmallGroupReserveInProgress(true);
    try {
      const blockId = block ? parseInt(block, 10) : NaN;
      const res = await fetch("/api/class-bookings/book-small-group-from-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurrence_date: highlightDate,
          start_time,
          duration_hours: smallGroupHours,
          duration_minutes: smallGroupHours * 60,
          ...(!Number.isNaN(blockId) ? { trainer_availability_id: blockId } : {}),
          ...(selectedTrainerIdFromUrl ? { trainer_member_id: selectedTrainerIdFromUrl } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok && data.occurrence_id) {
        if (typeof data.share_url === "string" && data.share_url) {
          try {
            await navigator.clipboard.writeText(data.share_url);
          } catch {
            /* ignore */
          }
        }
        router.push(`/member/book-classes?occurrence=${data.occurrence_id}`);
      } else {
        alert(data.error ?? "Could not reserve Small-Group PT");
      }
    } finally {
      setSmallGroupReserveInProgress(false);
    }
  }

  async function addSlotToCart() {
    if (!slotFromSchedule || !highlightDate || !highlightTime || !memberId || !slotProduct) return;
    if (!(await ensurePhoneOnFile())) return;
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
        sameDaySlotFromSchedule ? (
          <div className="mb-6 p-4 rounded-xl border-2 border-amber-200 bg-amber-50/40">
            <h2 className="font-semibold text-stone-800 mb-2">Book This Slot</h2>
            <p className="text-sm text-stone-600 mb-3">
              {highlightDate} at {slotTimeDisplay}
            </p>
            <SameDaySchedulingNotice dateYmd={highlightDate} className="mb-4" />
            <Link href="/schedule" className="inline-block text-sm font-medium text-brand-600 hover:underline">
              ← Back to schedule
            </Link>
          </div>
        ) : (
        <div className="mb-6 p-4 rounded-xl border-2 border-brand-200 bg-brand-50">
          <h2 className="font-semibold text-stone-800 mb-2">Book This Slot</h2>
          {selectedTrainerNameFromUrl && (
            <p className="text-sm font-medium text-brand-700 mb-2">
              Booking with <span className="font-semibold">{selectedTrainerNameFromUrl}</span>
            </p>
          )}
          <p className="text-sm text-stone-600 mb-3">
            {highlightDate} at {slotTimeDisplay}
          </p>
          {needsPhone && (
            <div className="mb-4 p-3 rounded-lg border border-brand-200 bg-white">
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Phone number <span className="text-red-600">*</span>
              </label>
              <p className="text-xs text-stone-500 mb-2">
                We need a phone number on file before you can book PT. It&apos;s saved to your profile for future bookings.
              </p>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full max-w-md px-3 py-2 rounded-lg border border-stone-200 text-stone-900"
                autoComplete="tel"
                placeholder="(808) 555-1234"
              />
            </div>
          )}
          {isFirstTimePtBooker && slotBookingKind === "pt" && (
            <p className="text-sm text-brand-900 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 leading-relaxed mb-4">
              {FIRST_TIME_PT_INFO_MESSAGE}
            </p>
          )}
          <fieldset className="mb-4 space-y-2">
            <legend className="text-sm font-medium text-stone-700 mb-1">What do you want to book?</legend>
            <label className="flex items-start gap-2 p-3 rounded-lg border border-stone-200 bg-white cursor-pointer has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input
                type="radio"
                name="slotBookingKind"
                checked={slotBookingKind === "pt"}
                onChange={() => setSlotBookingKind("pt")}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-stone-800 block">PT (1-on-1)</span>
                <span className="text-xs text-stone-500">Use a PT credit or pay online.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 p-3 rounded-lg border border-stone-200 bg-white cursor-pointer has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input
                type="radio"
                name="slotBookingKind"
                checked={slotBookingKind === "small_group_pt"}
                onChange={() => setSlotBookingKind("small_group_pt")}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-stone-800 block">Small-Group PT</span>
                <span className="text-xs text-stone-500">
                  Free to reserve · ${OPEN_GROUP_HOURLY_RATE}/hr at the gym · invite up to{" "}
                  {OPEN_GROUP_MAX_PARTICIPANTS - 1} friends · no cancellation fee
                </span>
              </span>
            </label>
          </fieldset>
          {slotBookingKind === "small_group_pt" ? (
            <div className="mb-3">
              <label className="block text-sm font-medium text-stone-700 mb-1">How long</label>
              <select
                value={smallGroupHours}
                onChange={(e) => setSmallGroupHours(Number(e.target.value) === 2 ? 2 : 1)}
                className="w-full max-w-md px-3 py-2 rounded-lg border border-stone-200"
              >
                <option value={1}>1 hour — ${OPEN_GROUP_HOURLY_RATE}</option>
                <option value={2}>2 hours — ${OPEN_GROUP_HOURLY_RATE * 2}</option>
              </select>
              <p className="text-xs text-stone-500 mt-1">
                {smallGroupPtPriceSummary(smallGroupHours)} at the gym · blocks {smallGroupHours} hr on the schedule
              </p>
            </div>
          ) : (
            <div className="mb-3">
              <label className="block text-sm font-medium text-stone-700 mb-1">Session length</label>
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
              {canStackTwoThirty && (
                <p className="text-sm text-brand-900 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 leading-relaxed mt-2">
                  {FIRST_TIME_PT_STACK_30_PROMPT}
                </p>
              )}
              {firstTimeNeedsHour && (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed mt-2">
                  {FIRST_TIME_PT_SHORT_SESSION_NO_STACK_MESSAGE}
                </p>
              )}
              {slotProduct && canStackTwoThirty && (
                <p className="text-xs text-stone-500 mt-1">
                  60 min blocked on the schedule · uses 2×30-min credits
                </p>
              )}
              {slotProduct && !canStackTwoThirty && !firstTimeNeedsHour && (
                <p className="text-xs text-stone-500 mt-1">
                  {slotProduct.duration_minutes} min · blocks this time on the schedule
                </p>
              )}
            </div>
          )}
          {slotBookingKind === "small_group_pt" ? (
            <div className="space-y-3">
              {slotFree === false && (
                <p className="text-amber-700 text-sm font-medium">
                  This time doesn&apos;t have enough space for a {smallGroupHours}-hour session. Please choose another slot on the{" "}
                  <Link href="/schedule" className="underline">schedule</Link>.
                </p>
              )}
              <p className="text-sm text-stone-600 leading-relaxed">
                Reserving holds this time on the schedule. You won&apos;t be charged in the app — pay{" "}
                {smallGroupPtPriceSummary(smallGroupHours)} at the gym after your session. Invite friends from the next screen.
                Cancel anytime before the session with <strong>no cancellation fee</strong>.
              </p>
              <button
                type="button"
                onClick={() => void reserveSmallGroupPt()}
                disabled={smallGroupReserveInProgress || slotFree === false || phoneSaving || (needsPhone && !phoneInput.trim())}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {smallGroupReserveInProgress ? "Reserving…" : "Reserve Small-Group PT"}
              </button>
            </div>
          ) : slotProduct ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-stone-700">
                  {slotProduct.session_name} — ${slotProduct.price}
                </span>
                {slotFree === false && (
                  <p className="text-amber-700 text-sm font-medium w-full">
                    This time doesn&apos;t have enough space for a{" "}
                    {canStackTwoThirty ? "60-minute first visit" : `${slotProduct.duration_minutes}-min session`}. Please choose
                    another slot on the <Link href="/schedule" className="underline">schedule</Link>.
                  </p>
                )}
                {canStackTwoThirty && (
                  <button
                    type="button"
                    onClick={() => void submitStackTwoThirtyCredits()}
                    disabled={
                      stackBookingInProgress ||
                      slotFree === false ||
                      phoneSaving ||
                      (needsPhone && !phoneInput.trim()) ||
                      (credits[30] ?? 0) < 2
                    }
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {stackBookingInProgress ? "Booking…" : "Use 2×30-min credits (60-min first visit)"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={submitSlotWithCredit}
                  disabled={
                    slotBookingInProgress ||
                    (credits[slotProduct.duration_minutes] ?? 0) < 1 ||
                    slotFree === false ||
                    phoneSaving ||
                    (needsPhone && !phoneInput.trim()) ||
                    firstTimeNeedsHour ||
                    canStackTwoThirty
                  }
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {slotBookingInProgress ? "Booking…" : `Use 1 credit (${slotProduct.duration_minutes} min)`}
                </button>
                <button
                  type="button"
                  onClick={addSlotToCart}
                  disabled={
                    slotAddToCartInProgress ||
                    slotFree === false ||
                    phoneSaving ||
                    (needsPhone && !phoneInput.trim()) ||
                    firstTimeNeedsHour ||
                    canStackTwoThirty
                  }
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
          {slotProduct && slotBookingKind === "pt" && (credits[slotProduct.duration_minutes] ?? 0) < 1 && (
            <p className="text-xs text-stone-500 mt-2">No {slotProduct.duration_minutes}-min credit? Add to cart to pay instead.</p>
          )}
        </div>
        )
      ) : (
        <>
          {trainers.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-stone-800 mb-2">Choose a trainer</h2>
              <p className="text-sm text-stone-600 mb-3">
                View a trainer’s schedule to see when they’re available, or choose No Preference to see all available times.
              </p>
              <ul className="space-y-2">
                <li>
                  <Link
                    href={selectedProductId != null ? `/schedule?product=${selectedProductId}` : "/schedule"}
                    className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
                  >
                    <span className="font-medium text-stone-800">No Preference</span>
                    <span className="text-sm text-brand-600 font-medium">View all availability →</span>
                  </Link>
                </li>
                {trainers.map((t) => {
                  const scheduleHref = selectedProductId != null
                    ? `/schedule?trainer=${encodeURIComponent(t.member_id)}&product=${selectedProductId}`
                    : `/schedule?trainer=${encodeURIComponent(t.member_id)}`;
                  return (
                    <li key={t.member_id}>
                      <Link
                        href={scheduleHref}
                        className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
                      >
                        <span className="font-medium text-stone-800">{t.display_name}</span>
                        <span className="text-sm text-brand-600 font-medium">View schedule →</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-stone-500 mt-3">
                Or go to the{" "}
                <Link href={selectedProductId != null ? `/schedule?product=${selectedProductId}` : "/schedule"} className="text-brand-600 hover:underline">
                  Schedule
                </Link>{" "}
                and use &quot;No Preference&quot; or a specific trainer there.
              </p>
            </div>
          )}
          <p className="text-stone-600 mb-6">
            {trainers.length > 0 ? (
              <>
                After you pick a time on a trainer’s schedule, you can book here with a credit or add to cart. Your PT credits:{" "}
                <strong>{ptCreditsSummary}</strong>. (Credits are per session length — book a slot that matches the pack you bought.)
              </>
            ) : (
              <>
                Pick an{" "}
                <Link
                  href={selectedProductId != null ? `/schedule?product=${selectedProductId}` : "/schedule"}
                  className="text-brand-600 hover:underline font-medium"
                >
                  available time on the Schedule
                </Link>{" "}
                to book a PT session. Your PT credits: <strong>{ptCreditsSummary}</strong>.
              </>
            )}
          </p>
        </>
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

export default function MemberBookPTPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <MemberBookPTContent />
    </Suspense>
  );
}
