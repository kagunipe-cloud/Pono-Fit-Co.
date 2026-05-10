"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatInAppTz, todayInAppTz, weekStartInAppTz, addDaysToDateStr } from "@/lib/app-timezone";
import { useAppTimezone, useOpenHours } from "@/lib/settings-context";
import type { BlockSegment } from "@/lib/pt-availability";
import { isOpenGroupSessionKind } from "@/lib/open-group-pt";

type Occurrence = {
  id: number;
  class_name: string;
  instructor: string | null;
  occurrence_date: string;
  occurrence_time: string;
  capacity: number;
  booked_count: number;
  duration_minutes?: number;
  class_id?: number | null;
  recurring_class_id?: number | null;
  session_kind?: string;
  flat_session_price?: string | null;
};

type PtBlockWithSegments = { id: number; trainer: string; date: string; start_time: string; end_time: string; segments?: BlockSegment[] };

type UnavailableOccurrence = { id: number; trainer: string; date: string; start_time: string; end_time: string; description: string };

type CellItem =
  | { type: "class"; id: number; name: string; sub: string | null; occurrence_date: string; occurrence_time: string; booked_count: number; capacity: number; duration_minutes: number; classStartSlot: number; spanSlots: number; class_id?: number | null; recurring_class_id?: number | null; session_kind?: string; flat_session_price?: string | null }
  | { type: "class_span" }
  | { type: "unavailable"; id: number; description: string }
  | { type: "pt_segment"; blockId: number; trainer: string; start_time: string; end_time: string; booked: boolean; member_name?: string; member_id?: string; booking_id?: number; unavailable?: boolean; unavailable_block_id?: number; description?: string; payment_type?: string }
  | { type: "open_booked"; id?: number; member_id?: string; member_name?: string; trainer_name?: string | null; payment_type?: string }
  | { type: "available" }
  | { type: "trainer_not_available" };

const SLOT_MINUTES = 30;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Light-gray PT slots: no recurring trainer hours (not an admin block). */
const SCHEDULE_LABEL_TRAINER_NO_HOURS = "Trainer/s Unavailable";

/** Week range in gym timezone: Monday YYYY-MM-DD. */
function getInitialWeekStartStr(tz: string): string {
  return weekStartInAppTz(todayInAppTz(tz));
}

function parseTimeToMinutes(t: string): number {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return (h % 24) * 60 + m;
}

/** Schedule tile + modal: show member name when we have it (API may send "First Last"). */
function ptBookedMemberLabel(opts: {
  memberName?: string | null;
  memberId?: string | null;
  paymentType?: string | null;
  fallback?: string | null;
}): string {
  const name = (opts.memberName ?? "").trim();
  const who = name || (opts.memberId ?? "").trim() || (opts.fallback ?? "").trim() || "Member";
  if (opts.paymentType === "pay_on_arrival") return `Booked: ${who} · Pay on arrival`;
  return `Booked: ${who}`;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return "12:" + (m < 10 ? "0" : "") + m + " AM";
  if (h < 12) return h + ":" + (m < 10 ? "0" : "") + m + " AM";
  if (h === 12) return "12:" + (m < 10 ? "0" : "") + m + " PM";
  return h - 12 + ":" + (m < 10 ? "0" : "") + m + " PM";
}

function timeMinutesToTimeString(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function slotOverlaps(slotMin: number, startMin: number, endMin: number): boolean {
  const slotEnd = slotMin + SLOT_MINUTES;
  return startMin < slotEnd && endMin > slotMin;
}

type ScheduleGridProps = { variant: "member" | "master" | "trainer"; trainerMemberId?: string | null; trainerDisplayName?: string | null; /** When this changes (e.g. after trainer adds/removes availability), grid refetches. */ scheduleRefreshKey?: number; /** When true (e.g. admin viewing trainer on Trainers page), show Block time link and allow removing unavailable blocks. */ allowAdminEdit?: boolean; /** When admin or trainer clicks a slot on trainer view, can request to add availability for that slot (dayOfWeek 0-6, startTime, endTime). */ onAddAvailabilityForSlot?: (dayOfWeek: number, startTime: string, endTime: string) => void; /** Called after an availability block is deleted from the grid (e.g. so parent can refetch list). */ onAvailabilityChange?: () => void };

export default function ScheduleGrid({ variant, trainerMemberId, trainerDisplayName, scheduleRefreshKey, allowAdminEdit, onAddAvailabilityForSlot, onAvailabilityChange }: ScheduleGridProps) {
  const searchParams = useSearchParams();
  const tz = useAppTimezone();
  const { openHourMin, openHourMax } = useOpenHours();
  const TIME_SLOT_MIN = openHourMin * 60;
  const TIME_SLOT_MAX = openHourMax * 60;
  const productId = searchParams.get("product")?.trim() || null;
  const [weekStartStr, setWeekStartStr] = useState<string>(() => getInitialWeekStartStr(tz));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableOccurrence[]>([]);
  const [ptBlocks, setPtBlocks] = useState<PtBlockWithSegments[]>([]);
  const [openBookings, setOpenBookings] = useState<
    {
      id?: number;
      member_id?: string;
      occurrence_date: string;
      start_time: string;
      duration_minutes: number;
      member_name?: string;
      trainer_name?: string | null;
      trainer_member_id?: string | null;
      payment_type?: string | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const bookPtQuery = productId ? `&product=${encodeURIComponent(productId)}` : "";
  const isMaster = variant === "master";
  const isTrainer = variant === "trainer";
  const effectiveTrainerId = trainerMemberId ?? null;
  const trainerQuery = variant === "member" && effectiveTrainerId && trainerDisplayName
    ? `&trainer=${encodeURIComponent(effectiveTrainerId)}&trainer_name=${encodeURIComponent(trainerDisplayName)}`
    : "";
  const [unavailableDeletingId, setUnavailableDeletingId] = useState<number | null>(null);
  const [availabilityDeletingId, setAvailabilityDeletingId] = useState<number | null>(null);
  const [assignTrainerBookingId, setAssignTrainerBookingId] = useState<number | null>(null);
  const [trainers, setTrainers] = useState<{ member_id: string; display_name: string }[]>([]);
  const [assignTrainerSelected, setAssignTrainerSelected] = useState("");
  const [assignTrainerSubmitting, setAssignTrainerSubmitting] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const refreshKey = scheduleRefreshKey ?? localRefreshKey;
  type SelectedSlot = { date: string; slotMin: number; timeStr: string; item: CellItem };
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);

  const [trainerPickMembers, setTrainerPickMembers] = useState<{ member_id: string; first_name: string | null; last_name: string | null; email: string | null }[]>(
    []
  );
  const [trainerPickLoading, setTrainerPickLoading] = useState(false);
  const [trainerBookMemberQuery, setTrainerBookMemberQuery] = useState("");
  const [trainerBookMemberId, setTrainerBookMemberId] = useState("");
  const [trainerBookDuration, setTrainerBookDuration] = useState<30 | 60 | 90>(60);
  const [trainerBookUseCredit, setTrainerBookUseCredit] = useState(false);
  const [trainerBookSubmitting, setTrainerBookSubmitting] = useState(false);
  const [trainerBlockSubmitting, setTrainerBlockSubmitting] = useState(false);
  const [trainerHoldDescription, setTrainerHoldDescription] = useState("");
  const trainerMemberSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trainerMembersFetchAbortRef = useRef<AbortController | null>(null);

  // Recompute initial week when gym timezone loads/updates (SettingsContext fetches async)
  useEffect(() => {
    setWeekStartStr(getInitialWeekStartStr(tz));
  }, [tz]);

  const fromStr = weekStartStr;
  const toStr = addDaysToDateStr(weekStartStr, 6);

  useEffect(() => {
    setLoading(true);
    const ptUrl = effectiveTrainerId
      ? `/api/offerings/pt-availability?from=${fromStr}&to=${toStr}&segments=1&trainer_member_id=${encodeURIComponent(effectiveTrainerId)}`
      : `/api/offerings/pt-availability?from=${fromStr}&to=${toStr}&segments=1`;
    Promise.all([
      fetch(`/api/offerings/class-occurrences?from=${fromStr}&to=${toStr}`).then((r) => r.json()),
      fetch(`/api/offerings/unavailable-blocks?from=${fromStr}&to=${toStr}`).then((r) => r.json()),
      fetch(ptUrl).then((r) => r.json()),
      fetch(`/api/offerings/pt-open-bookings?from=${fromStr}&to=${toStr}${effectiveTrainerId ? `&trainer_member_id=${encodeURIComponent(effectiveTrainerId)}` : ""}`).then((r) => r.json()),
    ])
      .then(([classData, unavailData, ptData, openData]) => {
        setOccurrences(Array.isArray(classData) ? classData : []);
        setUnavailable(Array.isArray(unavailData) ? unavailData : []);
        setPtBlocks(Array.isArray(ptData) ? ptData : []);
        setOpenBookings(Array.isArray(openData) ? openData : []);
      })
      .catch(() => {
        setOccurrences([]);
        setUnavailable([]);
        setPtBlocks([]);
        setOpenBookings([]);
      })
      .finally(() => setLoading(false));
  }, [fromStr, toStr, effectiveTrainerId, refreshKey]);

  const dayDates = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysToDateStr(weekStartStr, i));
  }, [weekStartStr]);

  const timeSlots = useMemo(() => {
    const slots: number[] = [];
    for (let m = TIME_SLOT_MIN; m < TIME_SLOT_MAX; m += SLOT_MINUTES) slots.push(m);
    return slots;
  }, [TIME_SLOT_MIN, TIME_SLOT_MAX]);

  const grid = useMemo(() => {
    const unavailList = isTrainer && trainerDisplayName
      ? unavailable.filter((u) => u.trainer === "" || u.trainer === trainerDisplayName)
      : unavailable;
    const map = new Map<string, CellItem>();
    const CLASS_BUFFER_MINUTES = 15;
    for (const date of dayDates) {
      for (let slotMin = TIME_SLOT_MIN; slotMin < TIME_SLOT_MAX; slotMin += SLOT_MINUTES) {
        const key = `${date}-${slotMin}`;
        // Classes: block duration_minutes + 15 min across slots; first slot gets full item with rowSpan
        // When multiple classes overlap a slot (e.g. 8:00 class + buffer extends to 9:15), prefer the one that STARTS at this slot so back-to-back classes both show.
        // Cap earlier class spans so they don't extend into a later class's start slot.
        let classPlaced = false;
        const overlapping: Occurrence[] = [];
        for (const o of occurrences) {
          if (o.occurrence_date !== date) continue;
          const startMin = parseTimeToMinutes(o.occurrence_time);
          const durationMin = typeof o.duration_minutes === "number" ? o.duration_minutes : 60;
          const endMin = startMin + durationMin + CLASS_BUFFER_MINUTES;
          if (!slotOverlaps(slotMin, startMin, endMin)) continue;
          overlapping.push(o);
        }
        const toClassStartSlot = (startMin: number) =>
          Math.floor((startMin - TIME_SLOT_MIN) / SLOT_MINUTES) * SLOT_MINUTES + TIME_SLOT_MIN;
        const o = overlapping.find((occ) => toClassStartSlot(parseTimeToMinutes(occ.occurrence_time)) === slotMin)
          ?? overlapping[0];
        if (o) {
          const startMin = parseTimeToMinutes(o.occurrence_time);
          const durationMin = typeof o.duration_minutes === "number" ? o.duration_minutes : 60;
          const oClassStartSlot = toClassStartSlot(startMin);
          const idealSpan = Math.ceil((durationMin + CLASS_BUFFER_MINUTES) / SLOT_MINUTES);
          const otherStarts = occurrences
            .filter((x) => x.occurrence_date === date && x.id !== o.id)
            .map((x) => toClassStartSlot(parseTimeToMinutes(x.occurrence_time)));
          const nextStartSlot = otherStarts.filter((s) => s > oClassStartSlot).sort((a, b) => a - b)[0];
          const slotCountToNext = nextStartSlot != null ? (nextStartSlot - oClassStartSlot) / SLOT_MINUTES : Infinity;
          const spanSlots = Math.min(idealSpan, Math.floor(slotCountToNext));
          if (slotMin === oClassStartSlot) {
            map.set(key, {
              type: "class",
              id: o.id,
              name: o.class_name,
              sub: o.instructor,
              occurrence_date: o.occurrence_date,
              occurrence_time: o.occurrence_time,
              booked_count: o.booked_count,
              capacity: o.capacity,
              duration_minutes: durationMin,
              classStartSlot: oClassStartSlot,
              spanSlots,
              ...(o.class_id != null && { class_id: o.class_id }),
              ...(o.recurring_class_id != null && { recurring_class_id: o.recurring_class_id }),
              ...(o.session_kind != null && String(o.session_kind).trim() !== "" && { session_kind: String(o.session_kind) }),
              ...(o.flat_session_price != null && { flat_session_price: String(o.flat_session_price) }),
            });
          } else {
            map.set(key, { type: "class_span" });
          }
          classPlaced = true;
        }
        if (classPlaced) continue;
        // Check open bookings (pt_open_bookings) FIRST — they can overlap trainer blocks; conflict check uses them but display previously skipped them
        const PT_SPILLOVER = 15;
        const openBookingAtSlot = openBookings.find((b) => {
          if (b.occurrence_date !== date) return false;
          const startMin = parseTimeToMinutes(b.start_time);
          const useSpillover = effectiveTrainerId == null || (b.trainer_member_id ?? "").trim() === effectiveTrainerId.trim();
          const endMin = startMin + b.duration_minutes + (useSpillover ? PT_SPILLOVER : 0);
          return slotOverlaps(slotMin, startMin, endMin);
        });
        if (openBookingAtSlot) {
          map.set(key, {
            type: "open_booked",
            ...(openBookingAtSlot.id != null && { id: openBookingAtSlot.id }),
            ...(openBookingAtSlot.member_id != null &&
              String(openBookingAtSlot.member_id).trim() !== "" && { member_id: String(openBookingAtSlot.member_id).trim() }),
            ...(openBookingAtSlot.member_name != null && { member_name: openBookingAtSlot.member_name }),
            ...(openBookingAtSlot.trainer_name != null && { trainer_name: openBookingAtSlot.trainer_name }),
            ...(openBookingAtSlot.payment_type != null && { payment_type: openBookingAtSlot.payment_type }),
          });
          continue;
        }
        const memberWithTrainerFilter = variant === "member" && effectiveTrainerId != null;
        let ptItem: CellItem | null = null;
        // For trainer view: check trainer availability blocks BEFORE unavailable so availability overrides default "unavailable"
        if (isTrainer || memberWithTrainerFilter) {
          for (const block of ptBlocks) {
            if (block.date !== date || !block.segments) continue;
            for (const seg of block.segments) {
              const startMin = parseTimeToMinutes(seg.start_time);
              const endMin = parseTimeToMinutes(seg.end_time);
              if (slotOverlaps(slotMin, startMin, endMin)) {
                ptItem = {
                  type: "pt_segment",
                  blockId: block.id,
                  trainer: seg.trainer,
                  start_time: seg.start_time,
                  end_time: seg.end_time,
                  booked: seg.booked,
                  ...(seg.member_name != null && { member_name: seg.member_name }),
                  ...(seg.member_id != null && String(seg.member_id).trim() !== "" && { member_id: String(seg.member_id).trim() }),
                  ...(seg.booking_id != null && { booking_id: seg.booking_id }),
                  ...(seg.unavailable && { unavailable: true, description: seg.description }),
                  ...(seg.unavailable_block_id != null && { unavailable_block_id: seg.unavailable_block_id }),
                  ...(seg.payment_type != null && { payment_type: seg.payment_type }),
                };
                break;
              }
            }
            if (ptItem) break;
          }
        }
        if (ptItem) {
          map.set(key, ptItem);
          continue;
        }
        if (!isTrainer && !memberWithTrainerFilter) {
          // Member with no trainer filter: check available from any trainer
          const segmentsAtSlot: { seg: BlockSegment; block: PtBlockWithSegments }[] = [];
          for (const block of ptBlocks) {
            if (block.date !== date || !block.segments) continue;
            for (const seg of block.segments) {
              const startMin = parseTimeToMinutes(seg.start_time);
              const endMin = parseTimeToMinutes(seg.end_time);
              if (slotOverlaps(slotMin, startMin, endMin)) {
                segmentsAtSlot.push({ seg, block });
                break;
              }
            }
          }
          if (segmentsAtSlot.length > 0) {
            const anyAvailable = segmentsAtSlot.some(({ seg }) => !seg.booked);
            if (anyAvailable) {
              map.set(key, { type: "available" });
              continue;
            }
            const first = segmentsAtSlot[0];
            ptItem = {
              type: "pt_segment",
              blockId: first.block.id,
              trainer: first.seg.trainer,
              start_time: first.seg.start_time,
              end_time: first.seg.end_time,
              booked: true,
              ...(first.seg.member_name != null && { member_name: first.seg.member_name }),
              ...(first.seg.member_id != null && String(first.seg.member_id).trim() !== "" && { member_id: String(first.seg.member_id).trim() }),
              ...(first.seg.booking_id != null && { booking_id: first.seg.booking_id }),
              ...(first.seg.unavailable && { unavailable: true, description: first.seg.description }),
              ...(first.seg.unavailable_block_id != null && { unavailable_block_id: first.seg.unavailable_block_id }),
              ...(first.seg.payment_type != null && { payment_type: first.seg.payment_type }),
            };
            map.set(key, ptItem);
            continue;
          }
        }
        const unavailAtSlot = unavailList.find((u) => {
          if (u.date !== date) return false;
          const startMin = parseTimeToMinutes(u.start_time);
          const endMin = parseTimeToMinutes(u.end_time);
          return slotOverlaps(slotMin, startMin, endMin);
        });
        if (unavailAtSlot) {
          map.set(key, { type: "unavailable", id: unavailAtSlot.id, description: unavailAtSlot.description });
          continue;
        }
        // No trainer availability block at this slot — not available for PT (show Unavailable or trainer_not_available)
        map.set(key, { type: "trainer_not_available" });
      }
    }
    return map;
  }, [dayDates, occurrences, unavailable, openBookings, ptBlocks, isTrainer, trainerDisplayName, variant, effectiveTrainerId, TIME_SLOT_MIN, TIME_SLOT_MAX]);

  /** For rowSpan: (rowIndex, dateIndex) is a "hole" when a class cell above spans over this row. */
  const classSpanHoles = useMemo(() => {
    const holes: boolean[][] = [];
    for (let r = 0; r < timeSlots.length; r++) {
      holes[r] = [];
      for (let d = 0; d < dayDates.length; d++) {
        const key = `${dayDates[d]}-${timeSlots[r]}`;
        const item = grid.get(key);
        let isHole = false;
        for (let k = 1; k <= r; k++) {
          const keyAbove = `${dayDates[d]}-${timeSlots[r - k]}`;
          const above = grid.get(keyAbove);
          if (above?.type === "class" && "spanSlots" in above && above.spanSlots > k) {
            isHole = true;
            break;
          }
        }
        holes[r][d] = isHole;
      }
    }
    return holes;
  }, [grid, dayDates, timeSlots]);

  function prevWeek() {
    setWeekStartStr((s) => addDaysToDateStr(s, -7));
  }
  function nextWeek() {
    setWeekStartStr((s) => addDaysToDateStr(s, 7));
  }
  function goToToday() {
    setWeekStartStr(getInitialWeekStartStr(tz));
  }

  async function handleRemoveUnavailable(id: number) {
    if (!confirm("Clear this blocked-off hold? If members could book this window, it becomes bookable again.")) return;
    setUnavailableDeletingId(id);
    try {
      const res = await fetch(`/api/offerings/unavailable-blocks/${id}`, { method: "DELETE" });
      if (res.ok) setLocalRefreshKey((k) => k + 1);
      else {
        const data = await res.json();
        alert(data.error ?? "Failed to remove");
      }
    } finally {
      setUnavailableDeletingId(null);
    }
  }

  async function handleRemoveAvailabilityBlock(blockId: number) {
    if (!confirm("Remove this availability block? Existing PT bookings in this block will be removed.")) return;
    setAvailabilityDeletingId(blockId);
    try {
      const res = await fetch(`/api/trainer/availability/${blockId}`, { method: "DELETE" });
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        onAvailabilityChange?.();
        setSelectedSlot(null);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to remove");
      }
    } finally {
      setAvailabilityDeletingId(null);
    }
  }

  function getDayOfWeek(dateStr: string): number {
    return new Date(dateStr + "T12:00:00").getDay();
  }

  async function handleAssignTrainer(bookingId: number, trainerMemberId: string) {
    if (!trainerMemberId) return;
    setAssignTrainerSubmitting(true);
    try {
      const res = await fetch("/api/pt-bookings/convert-open-to-trainer-specific", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_booking_id: bookingId, trainer_member_id: trainerMemberId }),
      });
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setAssignTrainerBookingId(null);
        setSelectedSlot(null);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to assign");
      }
    } finally {
      setAssignTrainerSubmitting(false);
    }
  }

  async function handleCancelOpenBooking(id: number, paymentType?: string | null) {
    const restore = paymentType === "credit";
    if (!confirm(restore ? "Cancel this PT session? Their PT credit will be restored." : "Cancel this PT session for the client?")) return;
    try {
      const res = await fetch(`/api/offerings/pt-open-bookings/${id}`, { method: "DELETE" });
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setSelectedSlot(null);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to cancel");
      }
    } catch {
      alert("Failed to cancel");
    }
  }

  async function handleCancelBlockBooking(id: number, paymentType?: string | null) {
    const restore = paymentType === "credit";
    if (!confirm(restore ? "Cancel this PT session? Their PT credit will be restored." : "Cancel this PT session for the client?")) return;
    try {
      const res = await fetch("/api/admin/pt-bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "trainer_specific", id }),
      });
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setSelectedSlot(null);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to cancel");
      }
    } catch {
      alert("Failed to cancel");
    }
  }

  async function handleDeleteClassOccurrence(id: number) {
    if (!confirm("Delete this class occurrence? Existing bookings will be removed.")) return;
    try {
      const res = await fetch(`/api/offerings/class-occurrences/${id}`, { method: "DELETE" });
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setSelectedSlot(null);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  }

  useEffect(() => {
    if (!selectedSlot) {
      setTrainerBookMemberId("");
      setTrainerBookMemberQuery("");
      setTrainerPickMembers([]);
      setTrainerPickLoading(false);
      setTrainerBookDuration(60);
      setTrainerBookUseCredit(false);
      setTrainerHoldDescription("");
      trainerMemberSearchTimerRef.current && clearTimeout(trainerMemberSearchTimerRef.current);
      trainerMembersFetchAbortRef.current?.abort();
      return;
    }
    if (!isTrainer || allowAdminEdit) return;
    const it = selectedSlot.item;
    if (it.type !== "pt_segment" || it.booked || it.unavailable) return;
    setTrainerBookMemberId("");
    setTrainerBookMemberQuery("");
    setTrainerPickMembers([]);
    setTrainerBookDuration(60);
    setTrainerBookUseCredit(false);
  }, [selectedSlot, isTrainer, allowAdminEdit]);

  useEffect(() => {
    if (!selectedSlot || !isTrainer || allowAdminEdit) return;
    const it = selectedSlot.item;
    if (it.type !== "pt_segment" || it.booked || it.unavailable) return;

    const q = trainerBookMemberQuery.trim();
    if (q.length < 2) {
      setTrainerPickMembers([]);
      setTrainerPickLoading(false);
      return;
    }

    if (trainerMemberSearchTimerRef.current) clearTimeout(trainerMemberSearchTimerRef.current);
    trainerMemberSearchTimerRef.current = setTimeout(() => {
      trainerMembersFetchAbortRef.current?.abort();
      const ac = new AbortController();
      trainerMembersFetchAbortRef.current = ac;
      setTrainerPickLoading(true);
      fetch(`/api/members?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((list) =>
          setTrainerPickMembers(
            Array.isArray(list)
              ? list.map((m: { member_id: string; first_name: string | null; last_name: string | null; email: string | null }) => ({
                  member_id: String(m.member_id),
                  first_name: m.first_name,
                  last_name: m.last_name,
                  email: m.email,
                }))
              : []
          )
        )
        .catch((e: Error & { name?: string }) => {
          if (e.name !== "AbortError") setTrainerPickMembers([]);
        })
        .finally(() => {
          if (!ac.signal.aborted) setTrainerPickLoading(false);
        });
    }, 320);

    return () => {
      if (trainerMemberSearchTimerRef.current) clearTimeout(trainerMemberSearchTimerRef.current);
    };
  }, [selectedSlot, isTrainer, allowAdminEdit, trainerBookMemberQuery]);

  async function handleTrainerQuickBlock() {
    if (!selectedSlot) return;
    const desc = trainerHoldDescription.trim();
    if (desc.length < 2) {
      alert("Enter a short reason for this hold (everyone sees it on the schedule).");
      return;
    }
    setTrainerBlockSubmitting(true);
    try {
      const endMin = parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES;
      const res = await fetch("/api/offerings/unavailable-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recurrence_type: "one_time",
          occurrence_date: selectedSlot.date,
          start_time: selectedSlot.timeStr,
          end_time: timeMinutesToTimeString(endMin),
          description: desc,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setSelectedSlot(null);
      } else {
        alert(typeof data.error === "string" ? data.error : "Failed to block time");
      }
    } finally {
      setTrainerBlockSubmitting(false);
    }
  }

  async function handleTrainerBookPt() {
    if (!selectedSlot || selectedSlot.item.type !== "pt_segment") return;
    const item = selectedSlot.item;
    if (item.booked || item.unavailable) return;
    if (!trainerBookMemberId) {
      alert("Choose a member to book.");
      return;
    }
    setTrainerBookSubmitting(true);
    try {
      const res = await fetch("/api/pt-bookings/book-trainer-specific", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer_availability_id: item.blockId,
          occurrence_date: selectedSlot.date,
          start_time: selectedSlot.timeStr,
          session_duration_minutes: trainerBookDuration,
          member_id: trainerBookMemberId,
          use_credit: trainerBookUseCredit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLocalRefreshKey((k) => k + 1);
        setSelectedSlot(null);
      } else {
        alert(typeof data.error === "string" ? data.error : "Could not book this slot");
      }
    } finally {
      setTrainerBookSubmitting(false);
    }
  }

  const weekLabel = `${formatInAppTz(new Date(weekStartStr + "T12:00:00Z"), { month: "short", day: "numeric", year: "numeric" }, tz)} – ${formatInAppTz(new Date(toStr + "T12:00:00Z"), { month: "short", day: "numeric", year: "numeric" }, tz)}`;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            {isMaster ? "Master Schedule" : isTrainer ? (trainerDisplayName ? `${trainerDisplayName.split(/\s+/)[0]}'s Schedule` : "My Schedule") : "Schedule"}
          </h1>
          {isMaster && (
            <>
              <p className="mt-1 text-base font-medium text-stone-700">
                Click on a Time Slot to Book a Member.
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Add Recurring:{" "}
                <Link href="/recurring-classes" className="text-brand-600 hover:underline font-medium">Classes</Link>
                {" — "}
                <Link href="/pt-bookings/generate-recurring" className="text-brand-600 hover:underline font-medium">PT</Link>
                {" — "}
                <Link href="/admin/block-time" className="text-brand-600 hover:underline font-medium">Block off time</Link>
              </p>
            </>
          )}
          {isTrainer && !allowAdminEdit && (
            <p className="mt-1 text-base font-medium text-stone-700">
              Tap a cell: add weekly hours where you have none yet, clear a blocked hold, add a one-off hold, or book open PT slots.
            </p>
          )}
          {isTrainer && allowAdminEdit && trainerDisplayName && (
            <p className="mt-1 text-sm text-stone-500">
              Adjust this trainer&apos;s availability:{" "}
              <Link href={`/admin/block-time?trainer=${encodeURIComponent(trainerDisplayName)}`} className="text-brand-600 hover:underline font-medium">Block off time</Link>
              {" "}(or remove trainer availability blocks below)
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-stone-800">Class</span>
            <span className="rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-900">Open Group PT</span>
            <span className="rounded-lg border border-stone-300 bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700">{SCHEDULE_LABEL_TRAINER_NO_HOURS}</span>
            <span className="rounded-lg bg-stone-600 px-2.5 py-1 text-xs font-medium text-stone-100">Blocked hold</span>
            {(isMaster || isTrainer || allowAdminEdit) && (
              <>
                <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-amber-50">Open (needs trainer)</span>
                <span className="rounded-lg bg-violet-500 px-2.5 py-1 text-xs font-medium text-violet-50">Trainer-specific</span>
                <span className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-red-50">Pay on arrival</span>
              </>
            )}
            <span className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">Available</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isTrainer && !isMaster && (
            <>
              <Link href="/member/classes" className="text-brand-600 hover:underline font-medium">Browse Classes</Link>
              <span className="text-stone-300">|</span>
              <Link href="/member/book-pt" className="text-brand-600 hover:underline font-medium">Book PT</Link>
              <span className="text-stone-300">|</span>
            </>
          )}
          <button type="button" onClick={prevWeek} className="px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-sm font-medium text-stone-700">← Prev</button>
          <button type="button" onClick={goToToday} className="px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-sm font-medium text-stone-700">Today</button>
          <button type="button" onClick={nextWeek} className="px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-sm font-medium text-stone-700">Next →</button>
        </div>
      </header>

      {loading ? (
        <div className="rounded-xl border border-stone-200 bg-white p-12 text-center text-stone-500">Loading…</div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="p-3 border-b border-stone-100 bg-stone-50/80 flex flex-wrap items-center justify-center gap-3 text-sm rounded-t-xl">
            <span className="font-medium text-stone-600">{weekLabel}</span>
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-stone-800">Class</span>
            <span className="rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-900">Open Group PT</span>
            <span className="rounded-lg border border-stone-300 bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700">{SCHEDULE_LABEL_TRAINER_NO_HOURS}</span>
            <span className="rounded-lg bg-stone-600 px-2.5 py-1 text-xs font-medium text-stone-100">Blocked hold</span>
            {(isMaster || isTrainer || allowAdminEdit) && (
              <>
                <span className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-amber-50">Open (needs trainer)</span>
                <span className="rounded-lg bg-violet-500 px-2.5 py-1 text-xs font-medium text-violet-50">Trainer-specific</span>
                <span className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-red-50">Pay on arrival</span>
              </>
            )}
            <span className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">Available</span>
          </div>
          {/* overflow-y-clip: keeps horizontal scroll without forcing overflow-y:auto on this wrapper,
              which would break position:sticky thead relative to the shell main scroll container */}
          <div className="overflow-x-auto overflow-y-clip overscroll-x-contain rounded-b-xl">
            <table className="w-full border-separate border-spacing-0 relative" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="w-16 sm:w-20 py-2 px-1 sm:px-2 text-left text-xs font-medium text-stone-500 border-b border-r border-stone-200 bg-stone-50 sticky left-0 top-0 z-[35] shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]"
                  >
                    Time
                  </th>
                  {DAY_NAMES.map((name, i) => (
                    <th
                      key={name}
                      scope="col"
                      className="py-2 px-1 sm:px-2 text-center text-xs font-medium text-stone-600 border-b border-r border-stone-200 bg-stone-50 last:border-r-0 sticky top-0 z-[30] shadow-[0_2px_6px_-2px_rgba(0,0,0,0.06)]"
                    >
                      <span className="block">{name}</span>
                      <span className="block text-stone-400 font-normal">{parseInt(dayDates[i].slice(8, 10), 10)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((slotMin, rowIndex) => (
                  <tr key={slotMin}>
                    <th
                      scope="row"
                      className="align-top py-1 px-1 sm:px-2 text-xs font-normal text-stone-500 border-b border-r border-stone-200 whitespace-nowrap bg-white sticky left-0 z-[15] shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]"
                    >
                      {formatTime(slotMin)}
                    </th>
                    {dayDates.map((date, dateIndex) => {
                      const key = `${date}-${slotMin}`;
                      const item = grid.get(key) ?? ({ type: "available" } as CellItem);
                      const timeStr = timeMinutesToTimeString(slotMin);
                      const isHole = classSpanHoles[rowIndex]?.[dateIndex] === true;
                      if (isHole) return null;
                      return (
                        <td
                          key={date}
                          rowSpan={item.type === "class" ? item.spanSlots : undefined}
                          className="align-top p-1 min-w-[100px] sm:min-w-[120px] border-b border-r border-stone-100 last:border-r-0"
                          onClick={isMaster || isTrainer ? (e) => {
                            if ((e.target as HTMLElement).closest("a, button")) return;
                            setSelectedSlot({ date, slotMin, timeStr, item });
                          } : undefined}
                          role={isMaster || isTrainer ? "button" : undefined}
                          style={isMaster || isTrainer ? { cursor: "pointer" } : undefined}
                        >
                          {item.type === "class" && (
                            <div
                              className={
                                isOpenGroupSessionKind(item.session_kind)
                                  ? "rounded-lg border border-orange-300 bg-orange-50 px-2 py-1.5 hover:bg-orange-100/80 hover:border-orange-400 transition-colors"
                                  : "rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 hover:bg-blue-100/80 hover:border-blue-300 transition-colors"
                              }
                            >
                              <span className="font-medium text-stone-800 text-sm leading-tight block truncate" title={item.name}>{item.name}</span>
                              {item.sub && <span className="text-xs text-stone-500 block truncate" title={item.sub}>{item.sub}</span>}
                              {isOpenGroupSessionKind(item.session_kind) ? (
                                <span className="text-xs text-orange-900 font-medium block">
                                  ${item.flat_session_price ?? "80"} total at gym · {item.booked_count}/{item.capacity} spots
                                </span>
                              ) : (
                                <span className="text-xs text-stone-500 block">{item.booked_count}/{item.capacity}</span>
                              )}
                              <div className="flex flex-wrap gap-1 mt-1">
                                <Link href={`/schedule/${item.id}/roster`} className={`text-xs font-medium hover:underline ${isOpenGroupSessionKind(item.session_kind) ? "text-orange-700" : "text-blue-600"}`} onClick={(e) => e.stopPropagation()}>Roster</Link>
                                <span className="text-stone-300">·</span>
                                <Link href={variant === "master" ? `/admin/book-class-for-member?occurrence_id=${item.id}` : `/member/book-classes?occurrence=${item.id}`} className={`text-xs font-medium hover:underline ${isOpenGroupSessionKind(item.session_kind) ? "text-orange-700" : "text-blue-600"}`} onClick={(e) => e.stopPropagation()}>Book</Link>
                              </div>
                            </div>
                          )}
                          {item.type === "unavailable" && (() => {
                            const holdLabel = (item.description ?? "").trim() || "Blocked hold";
                            const staff = isMaster || allowAdminEdit || isTrainer;
                            return (
                            <div
                              className={`rounded-lg bg-stone-600 border border-stone-700 min-h-[2.5rem] flex items-center gap-1 px-2 py-1.5 text-stone-100 ${staff ? "justify-between" : "justify-center"}`}
                              title={holdLabel}
                            >
                              <span className={`text-xs truncate flex-1 min-w-0 ${staff ? "" : "text-center"}`}>{holdLabel}</span>
                              {staff ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleRemoveUnavailable(item.id); }}
                                  disabled={unavailableDeletingId === item.id}
                                  className="text-xs text-red-200 hover:text-white shrink-0 disabled:opacity-50"
                                >
                                  {unavailableDeletingId === item.id ? "…" : "Clear"}
                                </button>
                              ) : null}
                            </div>
                            );
                          })()}
                          {item.type === "open_booked" && (
                            <div
                              className={`rounded-lg min-h-[2.5rem] flex items-center px-2 py-1.5 ${
                                item.payment_type === "pay_on_arrival" && (isMaster || isTrainer || allowAdminEdit)
                                  ? "bg-red-500 border border-red-600 text-red-50"
                                  : (isMaster || isTrainer || allowAdminEdit)
                                    ? "bg-amber-500 border border-amber-600 text-amber-50"
                                    : "bg-stone-400 text-stone-100"
                              }`}
                              title={isMaster || isTrainer || allowAdminEdit ? (item.payment_type === "pay_on_arrival" ? `${item.member_name ?? "PT"} (pay on arrival)` : `${item.member_name ?? "PT"} (open — assign trainer)`) : "Unavailable"}
                            >
                              {(isMaster || isTrainer || allowAdminEdit) ? (
                                <span
                                  className="text-xs truncate block w-full"
                                  title={ptBookedMemberLabel({
                                    memberName: item.member_name,
                                    memberId: item.member_id,
                                    paymentType: item.payment_type,
                                    fallback: item.trainer_name,
                                  })}
                                >
                                  {ptBookedMemberLabel({
                                    memberName: item.member_name,
                                    memberId: item.member_id,
                                    paymentType: item.payment_type,
                                    fallback: item.trainer_name,
                                  })}
                                </span>
                              ) : null}
                            </div>
                          )}
                          {item.type === "pt_segment" && (
                            <div className={`rounded-lg border px-2 py-1.5 min-h-[2.5rem] ${item.booked
                              ? (item.payment_type === "pay_on_arrival" && (isMaster || isTrainer || allowAdminEdit))
                                ? "bg-red-500 border-red-600 text-red-50"
                                : (isMaster || isTrainer || allowAdminEdit) && !item.unavailable
                                  ? "bg-violet-500 border-violet-600 text-violet-50"
                                  : item.unavailable
                                    ? "bg-stone-600 border-stone-700 text-stone-100"
                                    : "bg-stone-400 border-stone-500 text-stone-100"
                              : "bg-brand-50 border-2 border-brand-500 hover:border-brand-600"}`}>
                              {item.booked ? (
                                item.unavailable ? (
                                  <span className="text-xs block truncate text-center w-full px-0.5" title={(item.description ?? "").trim() || "Blocked hold"}>
                                    {(item.description ?? "").trim() || "Blocked hold"}
                                  </span>
                                ) : (isMaster || isTrainer || allowAdminEdit) ? (
                                  <span
                                    className={`text-xs block truncate ${item.payment_type === "pay_on_arrival" ? "text-red-100" : "text-violet-100"}`}
                                    title={ptBookedMemberLabel({
                                      memberName: item.member_name,
                                      memberId: item.member_id,
                                      paymentType: item.payment_type,
                                      fallback: item.trainer,
                                    })}
                                  >
                                    {ptBookedMemberLabel({
                                      memberName: item.member_name,
                                      memberId: item.member_id,
                                      paymentType: item.payment_type,
                                      fallback: item.trainer,
                                    })}
                                  </span>
                                ) : null
                              ) : (
                                <>
                                  <span className="text-xs font-medium text-stone-800">Available</span>
                                  {!isTrainer && <span className="text-xs text-stone-500 block truncate">{item.trainer}</span>}
                                  {!isTrainer && (
                                    <Link href={variant === "master" ? `/admin/book-pt-for-member?block=${item.blockId}&date=${date}&time=${item.start_time}` : `/member/book-pt?block=${item.blockId}&date=${date}&time=${item.start_time}${bookPtQuery || ""}${trainerQuery || ""}`} className="text-xs text-brand-600 hover:underline mt-0.5 inline-block" onClick={(e) => e.stopPropagation()}>Book</Link>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {item.type === "available" && (
                            <div className={`rounded-lg border min-h-[2.5rem] flex items-center justify-center transition-colors ${
                              isTrainer
                                ? "bg-stone-300 border-stone-400"
                                : "border-brand-200 bg-brand-50 hover:bg-brand-100"
                            } px-2 py-1.5`}>
                              {isTrainer ? (
                                <span className="text-xs text-stone-600 font-medium">{SCHEDULE_LABEL_TRAINER_NO_HOURS}</span>
                              ) : (
                                <Link href={variant === "master" ? `/admin/book-pt-for-member?date=${date}&time=${timeStr}` : `/member/book-pt?date=${date}&time=${timeStr}${bookPtQuery || ""}${trainerQuery || ""}`} className="text-xs text-brand-700 hover:text-brand-800 hover:underline">Available</Link>
                              )}
                            </div>
                          )}
                          {item.type === "trainer_not_available" && (
                            <div
                              className="rounded-lg border border-stone-300 bg-stone-200 min-h-[2.5rem] flex items-center justify-center px-2 py-1.5"
                              title="No recurring PT hours here yet — not an admin hold"
                            >
                              <span className="text-xs text-stone-700 font-medium text-center leading-tight">{SCHEDULE_LABEL_TRAINER_NO_HOURS}</span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && occurrences.length === 0 && unavailable.length === 0 && ptBlocks.length === 0 && (
        <p className="mt-4 text-center text-stone-500 text-sm">
          No classes or trainer availability blocks this week.{" "}
          {isMaster ? (
            <>Add recurring classes in <Link href="/recurring-classes" className="text-brand-600 hover:underline">Recurring classes</Link> or <Link href="/pt-bookings/generate-recurring" className="text-brand-600 hover:underline">PT recurring</Link>.</>
          ) : (
            <>Add classes in <Link href="/classes" className="text-brand-600 hover:underline">Classes</Link> or set up trainer availability for PT.</>
          )}
        </p>
      )}

      {(isMaster || isTrainer) && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedSlot(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-stone-800">Slot: {selectedSlot.date} at {selectedSlot.timeStr}</h3>
            <ul className="space-y-2 text-sm">
              {isTrainer && !allowAdminEdit && selectedSlot.item.type === "trainer_not_available" && onAddAvailabilityForSlot && (
                <li className="rounded-lg border border-brand-100 bg-brand-50/90 p-3 space-y-2">
                  <p className="text-xs text-stone-700 leading-snug">
                    This slot shows as <strong>{SCHEDULE_LABEL_TRAINER_NO_HOURS}</strong> until you add weekly PT hours here — that&apos;s the default, not a staff hold you remove.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onAddAvailabilityForSlot(getDayOfWeek(selectedSlot.date), selectedSlot.timeStr, timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES));
                      setSelectedSlot(null);
                    }}
                    className="w-full py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
                  >
                    Add weekly PT availability for this time
                  </button>
                </li>
              )}
              {(isMaster || allowAdminEdit) && (
                <li className="rounded-lg border border-stone-200 bg-stone-50/90 p-3 space-y-2">
                  <span className="font-medium text-stone-800 block text-sm">Block time / holds</span>
                  <Link
                    href={
                      isTrainer && trainerDisplayName
                        ? `/admin/block-time?trainer=${encodeURIComponent(trainerDisplayName)}&day=${getDayOfWeek(selectedSlot.date)}&start=${selectedSlot.timeStr}&end=${timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES)}`
                        : `/admin/block-time?day=${getDayOfWeek(selectedSlot.date)}&start=${selectedSlot.timeStr}&end=${timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES)}`
                    }
                    className="inline-flex items-center justify-center w-full py-2 rounded-lg bg-white border border-stone-300 text-stone-800 text-sm font-medium hover:bg-stone-100"
                  >
                    Block time (full editor)
                  </Link>
                </li>
              )}
              {isTrainer && !allowAdminEdit && (
                <li className="rounded-lg border border-stone-100 bg-stone-50 p-3 space-y-1.5">
                  <label className="block text-xs font-medium text-stone-600">Hold description (required)</label>
                  <p className="text-xs text-stone-500">Everyone sees this text on dark &quot;Blocked hold&quot; cells when you add a one-off hold.</p>
                  <input
                    type="text"
                    value={trainerHoldDescription}
                    onChange={(e) => setTrainerHoldDescription(e.target.value)}
                    placeholder="e.g. Dentist, vacation day"
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                  />
                </li>
              )}
              {isTrainer && !allowAdminEdit && (
                <li>
                  <button
                    type="button"
                    disabled={trainerBlockSubmitting}
                    onClick={() => void handleTrainerQuickBlock()}
                    className="text-left text-brand-600 hover:underline disabled:opacity-50"
                  >
                    {trainerBlockSubmitting ? "Saving…" : "Block this 30-minute slot (one-time)"}
                  </button>
                  <span className="block text-xs text-stone-500 mt-0.5">
                    {selectedSlot.item.type === "trainer_not_available"
                      ? "Optional: adds an explicit one-date hold on top of having no weekly hours (e.g. appointment)."
                      : "Creates an explicit hold for just this half-hour on this date (vacation, personal time)."}
                  </span>
                </li>
              )}
              {selectedSlot.item.type === "class" && selectedSlot.item.booked_count > 0 && (isMaster || allowAdminEdit) && (
                <>
                  <li className="pt-2 mt-1 border-t border-stone-200 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Booked class
                  </li>
                  <li>
                    <Link href={`/schedule/${selectedSlot.item.id}/roster`} className="text-brand-600 hover:underline block font-medium">
                      Roster — view members & cancel a booking
                    </Link>
                  </li>
                  <li>
                    <Link href={`/admin/book-class-for-member?occurrence_id=${selectedSlot.item.id}`} className="text-brand-600 hover:underline block">
                      Add another booking
                    </Link>
                  </li>
                  <li className="text-xs text-stone-500 pl-0 leading-snug">
                    To move someone to a different class, cancel them on the roster, then book the new occurrence from the schedule.
                  </li>
                </>
              )}
              {selectedSlot.item.type === "unavailable" && (isMaster || allowAdminEdit || isTrainer) && (
                <li>
                  <button type="button" onClick={() => { if (selectedSlot.item.type === "unavailable") { handleRemoveUnavailable(selectedSlot.item.id); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                    Clear blocked-off hold
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "class" && (isMaster || allowAdminEdit) && (
                <>
                  {selectedSlot.item.class_id != null && (
                    <li>
                      <Link href={`/classes/${selectedSlot.item.class_id}/edit`} className="text-brand-600 hover:underline block">Edit class</Link>
                    </li>
                  )}
                  {selectedSlot.item.recurring_class_id != null && (
                    <li>
                      <Link href="/recurring-classes" className="text-brand-600 hover:underline block">Manage recurring classes</Link>
                    </li>
                  )}
                  <li>
                    <button type="button" onClick={() => { if (selectedSlot.item.type === "class") { handleDeleteClassOccurrence(selectedSlot.item.id); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                      {selectedSlot.item.booked_count > 0 ? "Remove entire class from schedule" : "Delete this occurrence"}
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && (isMaster || allowAdminEdit) && (
                <li className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
                  <span className="font-medium text-stone-800 block">Book PT for a member</span>
                  <p className="text-xs text-stone-600 leading-snug">
                    Opens the full admin booking page — search any member, use credits, pay on arrival, or add to cart (same as Master schedule).
                  </p>
                  <Link
                    href={`/admin/book-pt-for-member?block=${selectedSlot.item.blockId}&date=${selectedSlot.date}&time=${selectedSlot.item.start_time}`}
                    className="block w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium text-center hover:bg-brand-700"
                  >
                    Open booking page
                  </Link>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && !selectedSlot.item.unavailable && isTrainer && !allowAdminEdit && (
                <li className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
                  <span className="font-medium text-stone-800 block">Book PT for a member</span>
                  <span className="text-xs text-stone-600 block">
                    Session is with you ({trainerDisplayName ?? "trainer"}). Starts at {selectedSlot.timeStr} for this slot.
                  </span>
                  <label className="block text-xs font-medium text-stone-500">Find member</label>
                  <input
                    type="search"
                    value={trainerBookMemberQuery}
                    onChange={(e) => setTrainerBookMemberQuery(e.target.value)}
                    placeholder="Name, email, or member ID (type 2+ characters)"
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                  />
                  <p className="text-[11px] text-stone-500">Searches the full member list (same as admin). Results appear after a short pause.</p>
                  <select
                    value={trainerBookMemberId}
                    onChange={(e) => setTrainerBookMemberId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    disabled={trainerPickLoading}
                  >
                    <option value="">
                      {trainerPickLoading
                        ? "Searching…"
                        : trainerBookMemberQuery.trim().length < 2
                          ? "— Type 2+ letters to search —"
                          : trainerPickMembers.length === 0
                            ? "— No matches —"
                            : "— Select member —"}
                    </option>
                    {trainerPickMembers.map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        {[m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.member_id}
                        {m.email ? ` · ${m.email}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-medium text-stone-500">Duration</span>
                    <select
                      value={trainerBookDuration}
                      onChange={(e) => setTrainerBookDuration(Number(e.target.value) as 30 | 60 | 90)}
                      className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm"
                    >
                      <option value={30}>30 min</option>
                      <option value={60}>60 min</option>
                      <option value={90}>90 min</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                    <input type="checkbox" checked={trainerBookUseCredit} onChange={(e) => setTrainerBookUseCredit(e.target.checked)} />
                    Use member&apos;s PT credit (if they have one for this length)
                  </label>
                  <button
                    type="button"
                    disabled={trainerBookSubmitting}
                    onClick={() => void handleTrainerBookPt()}
                    className="w-full py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {trainerBookSubmitting ? "Booking…" : "Book session"}
                  </button>
                  <button
                    type="button"
                    disabled={trainerBlockSubmitting}
                    onClick={() => void handleTrainerQuickBlock()}
                    className="w-full py-2 rounded-lg border border-stone-300 text-stone-700 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
                  >
                    {trainerBlockSubmitting ? "Saving…" : "Or block this slot instead (one-time)"}
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && selectedSlot.item.unavailable && selectedSlot.item.unavailable_block_id != null && (isTrainer || allowAdminEdit) && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      const id = selectedSlot.item.type === "pt_segment" ? selectedSlot.item.unavailable_block_id : undefined;
                      if (id != null) {
                        handleRemoveUnavailable(id);
                        setSelectedSlot(null);
                      }
                    }}
                    className="text-red-600 hover:underline text-sm"
                  >
                    Clear one-off hold (this blocked window)
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && selectedSlot.item.booked && selectedSlot.item.booking_id != null && !selectedSlot.item.unavailable && (isMaster || allowAdminEdit || isTrainer) && (
                <>
                  <li className="pt-2 mt-1 border-t border-stone-200 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Booked PT session
                  </li>
                  <li className="text-sm text-stone-800 font-medium">
                    {ptBookedMemberLabel({
                      memberName: selectedSlot.item.member_name,
                      memberId: selectedSlot.item.member_id,
                      paymentType: selectedSlot.item.payment_type,
                      fallback: selectedSlot.item.trainer,
                    })}
                  </li>
                  {selectedSlot.item.member_id ? (
                    <li>
                      <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}`} className="text-brand-600 hover:underline block font-medium">
                        Member profile
                      </Link>
                    </li>
                  ) : null}
                  {(isMaster || allowAdminEdit) && (
                    <>
                      <li>
                        <Link
                          href={`/admin/book-pt-for-member?date=${encodeURIComponent(selectedSlot.date)}&time=${encodeURIComponent(String(selectedSlot.item.start_time ?? "").trim().slice(0, 5))}&block=${selectedSlot.item.blockId}${selectedSlot.item.member_id ? `&member_id=${encodeURIComponent(selectedSlot.item.member_id)}` : ""}`}
                          className="text-brand-600 hover:underline block"
                        >
                          Book a new time (cancel this session first if moving them)
                        </Link>
                      </li>
                      {selectedSlot.item.payment_type === "pay_on_arrival" && selectedSlot.item.member_id ? (
                        <>
                          <li>
                            <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}/cart`} className="text-brand-600 hover:underline block">
                              Pay now (desk checkout)
                            </Link>
                          </li>
                          <li>
                            <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}`} className="text-brand-600 hover:underline block">
                              Update payment method
                            </Link>
                          </li>
                        </>
                      ) : selectedSlot.item.member_id ? (
                        <li>
                          <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}`} className="text-brand-600 hover:underline block">
                            Update payment method
                          </Link>
                        </li>
                      ) : null}
                    </>
                  )}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedSlot.item.type === "pt_segment" && selectedSlot.item.booking_id != null) {
                          handleCancelBlockBooking(selectedSlot.item.booking_id, selectedSlot.item.payment_type ?? null);
                          setSelectedSlot(null);
                        }
                      }}
                      className="text-red-600 hover:underline"
                    >
                      Cancel PT session
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null && (isMaster || allowAdminEdit) && (
                <>
                  <li className="pt-2 mt-1 border-t border-stone-200 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Booked PT session
                  </li>
                  <li className="text-sm text-stone-800 font-medium">
                    {ptBookedMemberLabel({
                      memberName: selectedSlot.item.member_name,
                      memberId: selectedSlot.item.member_id,
                      paymentType: selectedSlot.item.payment_type,
                      fallback: selectedSlot.item.trainer_name,
                    })}
                  </li>
                  {selectedSlot.item.member_id ? (
                    <li>
                      <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}`} className="text-brand-600 hover:underline block font-medium">
                        Member profile
                      </Link>
                    </li>
                  ) : null}
                  <li>
                    <Link href={`/admin/edit-open-pt-booking?id=${selectedSlot.item.id}`} className="text-brand-600 hover:underline block">
                      Reschedule (change date or time)
                    </Link>
                  </li>
                  {selectedSlot.item.member_id ? (
                    <>
                      {selectedSlot.item.payment_type === "pay_on_arrival" ? (
                        <li>
                          <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}/cart`} className="text-brand-600 hover:underline block">
                            Pay now (desk checkout)
                          </Link>
                        </li>
                      ) : null}
                      <li>
                        <Link href={`/members/${encodeURIComponent(selectedSlot.item.member_id)}`} className="text-brand-600 hover:underline block">
                          Update payment method
                        </Link>
                      </li>
                    </>
                  ) : null}
                  {assignTrainerBookingId === selectedSlot.item.id ? (
                    <li className="space-y-2">
                      <span className="font-medium text-stone-700">Assign to trainer:</span>
                      <select
                        value={assignTrainerSelected}
                        onChange={(e) => setAssignTrainerSelected(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                      >
                        <option value="">— No preference (leave open) —</option>
                        {trainers.map((t) => (
                          <option key={t.member_id} value={t.member_id}>
                            {t.display_name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null) {
                              handleAssignTrainer(selectedSlot.item.id, assignTrainerSelected);
                            }
                          }}
                          disabled={assignTrainerSubmitting}
                          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
                        >
                          {assignTrainerSubmitting ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssignTrainerBookingId(null)}
                          className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null) {
                            setAssignTrainerBookingId(selectedSlot.item.id);
                            setAssignTrainerSelected("");
                            fetch("/api/trainers")
                              .then((r) => r.json())
                              .then((list) => setTrainers(Array.isArray(list) ? list : []))
                              .catch(() => setTrainers([]));
                          }
                        }}
                        className="text-brand-600 hover:underline"
                      >
                        {selectedSlot.item.trainer_name ? `Change trainer (${selectedSlot.item.trainer_name})` : "Assign to trainer"}
                      </button>
                    </li>
                  )}
                  <li>
                    <button type="button" onClick={() => { if (selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null) { handleCancelOpenBooking(selectedSlot.item.id, selectedSlot.item.payment_type ?? null); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                      Cancel PT session
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "available" && (isMaster || allowAdminEdit) && (
                <li className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
                  <span className="font-medium text-stone-800 block text-sm">Book PT (no trainer preference)</span>
                  <Link
                    href={`/admin/book-pt-for-member?date=${selectedSlot.date}&time=${selectedSlot.timeStr}`}
                    className="block w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium text-center hover:bg-brand-700"
                  >
                    Open booking page
                  </Link>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && !selectedSlot.item.unavailable && isTrainer && (
                <li>
                  <button
                    type="button"
                    onClick={() => { if (selectedSlot.item.type === "pt_segment") { handleRemoveAvailabilityBlock(selectedSlot.item.blockId); } }}
                    disabled={availabilityDeletingId === (selectedSlot.item.type === "pt_segment" ? selectedSlot.item.blockId : null)}
                    className="text-red-600 hover:underline disabled:opacity-50 text-sm"
                  >
                    {availabilityDeletingId === (selectedSlot.item.type === "pt_segment" ? selectedSlot.item.blockId : null)
                      ? "Removing…"
                      : "Remove entire recurring availability block (not just this week)"}
                  </button>
                </li>
              )}
              {isTrainer && onAddAvailabilityForSlot && selectedSlot.item.type === "available" && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onAddAvailabilityForSlot(getDayOfWeek(selectedSlot.date), selectedSlot.timeStr, timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES));
                      setSelectedSlot(null);
                    }}
                    className="text-brand-600 hover:underline"
                  >
                    Add weekly PT availability for this time
                  </button>
                </li>
              )}
            </ul>
            <button type="button" onClick={() => setSelectedSlot(null)} className="w-full py-2 rounded-lg border border-stone-200 text-stone-700 text-sm font-medium hover:bg-stone-50">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
