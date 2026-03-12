"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatInAppTz, todayInAppTz, weekStartInAppTz, addDaysToDateStr } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";

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
};

type BlockSegment = { start_time: string; end_time: string; booked: boolean; member_name?: string; trainer: string; booking_id?: number };
type PtBlockWithSegments = { id: number; trainer: string; date: string; start_time: string; end_time: string; segments?: BlockSegment[] };

type UnavailableOccurrence = { id: number; trainer: string; date: string; start_time: string; end_time: string; description: string };

type CellItem =
  | { type: "class"; id: number; name: string; sub: string | null; occurrence_date: string; occurrence_time: string; booked_count: number; capacity: number; duration_minutes: number; classStartSlot: number; spanSlots: number; class_id?: number | null; recurring_class_id?: number | null }
  | { type: "class_span" }
  | { type: "unavailable"; id: number; description: string }
  | { type: "pt_segment"; blockId: number; trainer: string; start_time: string; end_time: string; booked: boolean; member_name?: string; booking_id?: number }
  | { type: "open_booked"; id?: number; member_name?: string; trainer_name?: string | null }
  | { type: "available" }
  | { type: "trainer_not_available" };

const TIME_SLOT_MIN = 6 * 60;
const TIME_SLOT_MAX = 22 * 60;
const SLOT_MINUTES = 30;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const productId = searchParams.get("product")?.trim() || null;
  const [weekStartStr, setWeekStartStr] = useState<string>(() => getInitialWeekStartStr(tz));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableOccurrence[]>([]);
  const [ptBlocks, setPtBlocks] = useState<PtBlockWithSegments[]>([]);
  const [openBookings, setOpenBookings] = useState<{ id?: number; occurrence_date: string; start_time: string; duration_minutes: number; member_name?: string; trainer_name?: string | null }[]>([]);
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
  }, []);

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
            });
          } else {
            map.set(key, { type: "class_span" });
          }
          classPlaced = true;
        }
        if (classPlaced) continue;
        const memberWithTrainerFilter = variant === "member" && effectiveTrainerId != null;
        let ptItem: CellItem | null = null;
        // For trainer view: check PT blocks BEFORE unavailable so availability overrides default "unavailable"
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
                  ...(seg.booking_id != null && { booking_id: seg.booking_id }),
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
              ...(first.seg.booking_id != null && { booking_id: first.seg.booking_id }),
            };
            map.set(key, ptItem);
            continue;
          }
        }
        const PT_SPILLOVER = 15;
        const openBookingAtSlot = openBookings.find((b) => {
          if (b.occurrence_date !== date) return false;
          const startMin = parseTimeToMinutes(b.start_time);
          const endMin = startMin + b.duration_minutes + PT_SPILLOVER;
          return slotOverlaps(slotMin, startMin, endMin);
        });
        if (openBookingAtSlot) {
          map.set(key, {
            type: "open_booked",
            ...(openBookingAtSlot.id != null && { id: openBookingAtSlot.id }),
            ...(openBookingAtSlot.member_name != null && { member_name: openBookingAtSlot.member_name }),
            ...(openBookingAtSlot.trainer_name != null && { trainer_name: openBookingAtSlot.trainer_name }),
          });
          continue;
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
        // No PT block at this slot — not available for PT (show Unavailable or trainer_not_available)
        map.set(key, { type: "trainer_not_available" });
      }
    }
    return map;
  }, [dayDates, occurrences, unavailable, openBookings, ptBlocks, isTrainer, trainerDisplayName, variant, effectiveTrainerId]);

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
    if (!confirm("Remove this blocked time?")) return;
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
    setAssignTrainerSubmitting(true);
    try {
      const res = await fetch(`/api/offerings/pt-open-bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainer_member_id: trainerMemberId || null }),
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

  async function handleCancelOpenBooking(id: number) {
    if (!confirm("Cancel this PT session for the client? Their credit will be restored.")) return;
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

  async function handleCancelBlockBooking(id: number) {
    if (!confirm("Cancel this PT session for the client? Their credit will be restored.")) return;
    try {
      const res = await fetch("/api/admin/pt-bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "block", id }),
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
                <Link href="/admin/block-time" className="text-brand-600 hover:underline font-medium">Blocked Time</Link>
              </p>
            </>
          )}
          {isTrainer && allowAdminEdit && trainerDisplayName && (
            <p className="mt-1 text-sm text-stone-500">
              Adjust this trainer&apos;s availability:{" "}
              <Link href={`/admin/block-time?trainer=${encodeURIComponent(trainerDisplayName)}`} className="text-brand-600 hover:underline font-medium">Block time</Link>
              {" "}(or remove blocks below)
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-stone-800">Class</span>
            <span className="rounded-lg bg-stone-400 px-2.5 py-1 text-xs font-medium text-stone-100">Unavailable</span>
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
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <div className="p-3 border-b border-stone-100 bg-stone-50/80 flex flex-wrap items-center justify-center gap-3 text-sm">
            <span className="font-medium text-stone-600">{weekLabel}</span>
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-stone-800">Class</span>
            <span className="rounded-lg bg-stone-400 px-2.5 py-1 text-xs font-medium text-stone-100">Unavailable</span>
            <span className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">Available</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th className="w-16 sm:w-20 py-2 px-1 sm:px-2 text-left text-xs font-medium text-stone-500 border-b border-r border-stone-200 bg-stone-50/50">Time</th>
                  {DAY_NAMES.map((name, i) => (
                    <th key={name} className="py-2 px-1 sm:px-2 text-center text-xs font-medium text-stone-600 border-b border-r border-stone-200 bg-stone-50/50 last:border-r-0">
                      <span className="block">{name}</span>
                      <span className="block text-stone-400 font-normal">{parseInt(dayDates[i].slice(8, 10), 10)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((slotMin, rowIndex) => (
                  <tr key={slotMin} className="border-b border-stone-100 last:border-b-0">
                    <td className="align-top py-1 px-1 sm:px-2 text-xs text-stone-500 border-r border-stone-200 whitespace-nowrap">{formatTime(slotMin)}</td>
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
                          className="align-top p-1 min-w-[100px] sm:min-w-[120px] border-r border-stone-100 last:border-r-0"
                          onClick={isMaster || isTrainer ? (e) => {
                            if ((e.target as HTMLElement).closest("a, button")) return;
                            setSelectedSlot({ date, slotMin, timeStr, item });
                          } : undefined}
                          role={isMaster || isTrainer ? "button" : undefined}
                          style={isMaster || isTrainer ? { cursor: "pointer" } : undefined}
                        >
                          {item.type === "class" && (
                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 hover:bg-blue-100/80 hover:border-blue-300 transition-colors">
                              <span className="font-medium text-stone-800 text-sm leading-tight block truncate" title={item.name}>{item.name}</span>
                              {item.sub && <span className="text-xs text-stone-500 block truncate" title={item.sub}>{item.sub}</span>}
                              <span className="text-xs text-stone-500 block">{item.booked_count}/{item.capacity}</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                <Link href={`/schedule/${item.id}/roster`} className="text-xs text-blue-600 hover:underline font-medium" onClick={(e) => e.stopPropagation()}>Roster</Link>
                                <span className="text-stone-300">·</span>
                                <Link href={variant === "master" ? `/admin/book-class-for-member?occurrence_id=${item.id}` : `/member/book-classes?occurrence=${item.id}`} className="text-xs text-blue-600 hover:underline font-medium" onClick={(e) => e.stopPropagation()}>Book</Link>
                              </div>
                            </div>
                          )}
                          {item.type === "unavailable" && (
                            <div
                              className="rounded-lg bg-stone-400 min-h-[2.5rem] flex items-center justify-between gap-1 px-2 py-1.5 text-stone-100"
                              title={isMaster || isTrainer || allowAdminEdit ? item.description : "Unavailable"}
                            >
                              {(isMaster || isTrainer || allowAdminEdit) && item.description ? (
                                <span className="text-xs truncate flex-1 min-w-0" title={item.description}>{item.description}</span>
                              ) : null}
                              {(isMaster || allowAdminEdit) && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleRemoveUnavailable(item.id); }}
                                  disabled={unavailableDeletingId === item.id}
                                  className="text-xs text-red-200 hover:text-white shrink-0 disabled:opacity-50"
                                >
                                  {unavailableDeletingId === item.id ? "…" : "Remove"}
                                </button>
                              )}
                            </div>
                          )}
                          {item.type === "open_booked" && (
                            <div
                              className="rounded-lg bg-stone-400 min-h-[2.5rem] flex items-center px-2 py-1.5 text-stone-100"
                              title={isMaster || isTrainer ? (item.member_name ?? "PT booked") : "Unavailable"}
                            >
                              {(isMaster || isTrainer) ? (
                                <span className="text-xs truncate block w-full" title={item.member_name ?? "Booked"}>
                                  {item.member_name ?? "Booked"}
                                </span>
                              ) : null}
                            </div>
                          )}
                          {item.type === "pt_segment" && (
                            <div className={`rounded-lg border px-2 py-1.5 min-h-[2.5rem] ${item.booked ? "bg-stone-400 border-stone-500 text-stone-100" : "bg-brand-50 border-2 border-brand-500 hover:border-brand-600"}`}>
                              {item.booked ? (isMaster || isTrainer ? (
                                <span className="text-xs text-stone-200 block truncate" title={item.member_name ?? "Booked"}>
                                  {item.member_name ?? "Booked"}
                                </span>
                              ) : null) : (
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
                                <span className="text-xs text-stone-500">Unavailable</span>
                              ) : (
                                <Link href={variant === "master" ? `/admin/book-pt-for-member?date=${date}&time=${timeStr}` : `/member/book-pt?date=${date}&time=${timeStr}${bookPtQuery || ""}${trainerQuery || ""}`} className="text-xs text-brand-700 hover:text-brand-800 hover:underline">Available</Link>
                              )}
                            </div>
                          )}
                          {item.type === "trainer_not_available" && (
                            <div className="rounded-lg border border-stone-400 bg-stone-300 min-h-[2.5rem] flex items-center justify-center px-2 py-1.5">
                              <span className="text-xs text-stone-500">Unavailable</span>
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
          No classes or PT blocks this week.{" "}
          {isMaster ? (
            <>Add recurring classes in <Link href="/recurring-classes" className="text-brand-600 hover:underline">Recurring classes</Link> or <Link href="/pt-bookings/generate-recurring" className="text-brand-600 hover:underline">PT recurring</Link>.</>
          ) : (
            <>Add classes in <Link href="/classes" className="text-brand-600 hover:underline">Classes</Link> or set up trainer availability for PT.</>
          )}
        </p>
      )}

      {(isMaster || isTrainer) && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedSlot(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-stone-800">Slot: {selectedSlot.date} at {selectedSlot.timeStr}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={isTrainer && trainerDisplayName
                    ? `/admin/block-time?trainer=${encodeURIComponent(trainerDisplayName)}&day=${getDayOfWeek(selectedSlot.date)}&start=${selectedSlot.timeStr}&end=${timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES)}`
                    : `/admin/block-time?day=${getDayOfWeek(selectedSlot.date)}&start=${selectedSlot.timeStr}&end=${timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES)}`}
                  className="text-brand-600 hover:underline block"
                >
                  Add blocked time (unavailable)
                </Link>
              </li>
              {selectedSlot.item.type === "unavailable" && (isMaster || allowAdminEdit) && (
                <li>
                  <button type="button" onClick={() => { if (selectedSlot.item.type === "unavailable") { handleRemoveUnavailable(selectedSlot.item.id); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                    Remove this block
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
                      Delete this occurrence
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && (isMaster || allowAdminEdit) && (
                <li>
                  <Link href={`/admin/book-pt-for-member?block=${selectedSlot.item.blockId}&date=${selectedSlot.date}&time=${selectedSlot.item.start_time}`} className="text-brand-600 hover:underline block">
                    Assign PT (book for member)
                  </Link>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && selectedSlot.item.booked && selectedSlot.item.booking_id != null && (isMaster || allowAdminEdit) && (
                <li>
                  <button type="button" onClick={() => { if (selectedSlot.item.type === "pt_segment" && selectedSlot.item.booking_id != null) { handleCancelBlockBooking(selectedSlot.item.booking_id); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                    Cancel PT for client
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null && (isMaster || allowAdminEdit) && (
                <>
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
                    <button type="button" onClick={() => { if (selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null) { handleCancelOpenBooking(selectedSlot.item.id); setSelectedSlot(null); } }} className="text-red-600 hover:underline">
                      Cancel PT for client
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "available" && (isMaster || allowAdminEdit) && (
                <li>
                  <Link href={`/admin/book-pt-for-member?date=${selectedSlot.date}&time=${selectedSlot.timeStr}`} className="text-brand-600 hover:underline block">
                    Book PT (no preference)
                  </Link>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && isTrainer && (
                <li>
                  <button
                    type="button"
                    onClick={() => { if (selectedSlot.item.type === "pt_segment") { handleRemoveAvailabilityBlock(selectedSlot.item.blockId); } }}
                    disabled={availabilityDeletingId === (selectedSlot.item.type === "pt_segment" ? selectedSlot.item.blockId : null)}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    {availabilityDeletingId === (selectedSlot.item.type === "pt_segment" ? selectedSlot.item.blockId : null) ? "Removing…" : "Remove this availability block"}
                  </button>
                </li>
              )}
              {isTrainer && onAddAvailabilityForSlot && (selectedSlot.item.type === "available" || allowAdminEdit) && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onAddAvailabilityForSlot(getDayOfWeek(selectedSlot.date), selectedSlot.timeStr, timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES));
                      setSelectedSlot(null);
                    }}
                    className="text-brand-600 hover:underline"
                  >
                    Add availability for this slot
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
