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
  | { type: "open_booked"; id?: number; member_name?: string }
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

type ScheduleGridProps = { variant: "member" | "master" | "trainer"; trainerMemberId?: string | null; trainerDisplayName?: string | null; /** When this changes (e.g. after trainer adds/removes availability), grid refetches. */ scheduleRefreshKey?: number; /** When true (e.g. admin viewing trainer on Trainers page), show Block time link and allow removing unavailable blocks. */ allowAdminEdit?: boolean };

export default function ScheduleGrid({ variant, trainerMemberId, trainerDisplayName, scheduleRefreshKey, allowAdminEdit }: ScheduleGridProps) {
  const searchParams = useSearchParams();
  const tz = useAppTimezone();
  const productId = searchParams.get("product")?.trim() || null;
  const [weekStartStr, setWeekStartStr] = useState<string>(() => getInitialWeekStartStr(tz));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableOccurrence[]>([]);
  const [ptBlocks, setPtBlocks] = useState<PtBlockWithSegments[]>([]);
  const [openBookings, setOpenBookings] = useState<{ id?: number; occurrence_date: string; start_time: string; duration_minutes: number; member_name?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const bookPtQuery = productId ? `&product=${encodeURIComponent(productId)}` : "";
  const trainerQuery = variant === "member" && effectiveTrainerId && trainerDisplayName
    ? `&trainer=${encodeURIComponent(effectiveTrainerId)}&trainer_name=${encodeURIComponent(trainerDisplayName)}`
    : "";
  const isMaster = variant === "master";
  const isTrainer = variant === "trainer";
  const effectiveTrainerId = trainerMemberId ?? null;
  const [unavailableDeletingId, setUnavailableDeletingId] = useState<number | null>(null);
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
      fetch(`/api/offerings/pt-open-bookings?from=${fromStr}&to=${toStr}`).then((r) => r.json()),
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
        let classPlaced = false;
        for (const o of occurrences) {
          if (o.occurrence_date !== date) continue;
          const startMin = parseTimeToMinutes(o.occurrence_time);
          const durationMin = typeof o.duration_minutes === "number" ? o.duration_minutes : 60;
          const endMin = startMin + durationMin + CLASS_BUFFER_MINUTES;
          if (!slotOverlaps(slotMin, startMin, endMin)) continue;
          const classStartSlot = Math.floor((startMin - TIME_SLOT_MIN) / SLOT_MINUTES) * SLOT_MINUTES + TIME_SLOT_MIN;
          const spanSlots = Math.ceil((durationMin + CLASS_BUFFER_MINUTES) / SLOT_MINUTES);
          if (slotMin === classStartSlot) {
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
              classStartSlot,
              spanSlots,
              ...(o.class_id != null && { class_id: o.class_id }),
              ...(o.recurring_class_id != null && { recurring_class_id: o.recurring_class_id }),
            });
            classPlaced = true;
          } else {
            map.set(key, { type: "class_span" });
            classPlaced = true;
          }
          break;
        }
        if (classPlaced) continue;
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
        const PT_SPILLOVER = 15;
        const openBookingAtSlot = openBookings.find((b) => {
          if (b.occurrence_date !== date) return false;
          const startMin = parseTimeToMinutes(b.start_time);
          const endMin = startMin + b.duration_minutes + PT_SPILLOVER;
          return slotOverlaps(slotMin, startMin, endMin);
        });
        if (openBookingAtSlot) {
          map.set(key, { type: "open_booked", ...(openBookingAtSlot.id != null && { id: openBookingAtSlot.id }), ...(openBookingAtSlot.member_name != null && { member_name: openBookingAtSlot.member_name }) });
          continue;
        }
        let ptItem: CellItem | null = null;
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
        if (ptItem) {
          map.set(key, ptItem);
          continue;
        }
        // When member has a trainer selected, only show "available" inside that trainer's blocks; otherwise show trainer_not_available
        const memberWithTrainerFilter = variant === "member" && effectiveTrainerId != null;
        map.set(key, memberWithTrainerFilter ? { type: "trainer_not_available" } : { type: "available" });
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

  function getDayOfWeek(dateStr: string): number {
    return new Date(dateStr + "T12:00:00").getDay();
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
            {isMaster ? "Master Schedule" : isTrainer ? "My Schedule" : "Schedule"}
          </h1>
          {isMaster && (
            <p className="mt-1 text-sm text-stone-500">
              Add recurring:{" "}
              <Link href="/recurring-classes" className="text-brand-600 hover:underline font-medium">Recurring classes</Link>
              {" · "}
              <Link href="/pt-bookings/generate-recurring" className="text-brand-600 hover:underline font-medium">PT recurring</Link>
              {" · "}
              <Link href="/classes" className="text-brand-600 hover:underline font-medium">Classes</Link>
              {" · "}
              <Link href="/admin/block-time" className="text-brand-600 hover:underline font-medium">Block time</Link>
            </p>
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
          {!isTrainer && (
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
                          onClick={isMaster ? (e) => {
                            if ((e.target as HTMLElement).closest("a, button")) return;
                            setSelectedSlot({ date, slotMin, timeStr, item });
                          } : undefined}
                          role={isMaster ? "button" : undefined}
                          style={isMaster ? { cursor: "pointer" } : undefined}
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
                              title={isMaster || allowAdminEdit ? item.description : "Unavailable"}
                            >
                              {(isMaster || allowAdminEdit) && item.description ? (
                                <span className="text-xs truncate flex-1 min-w-0" title={item.description}>{item.description}</span>
                              ) : null}
                              {allowAdminEdit && (
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
                              title={isMaster ? (item.member_name ?? "PT booked") : "Unavailable"}
                            >
                              {isMaster ? (
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
                            <div className="rounded-lg border border-stone-200 bg-stone-100 min-h-[2.5rem] flex items-center justify-center px-2 py-1.5">
                              <span className="text-xs text-stone-400">—</span>
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

      {isMaster && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedSlot(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-stone-800">Slot: {selectedSlot.date} at {selectedSlot.timeStr}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={`/admin/block-time?day=${getDayOfWeek(selectedSlot.date)}&start=${selectedSlot.timeStr}&end=${timeMinutesToTimeString(parseTimeToMinutes(selectedSlot.timeStr) + SLOT_MINUTES)}`}
                  className="text-brand-600 hover:underline block"
                >
                  Add block time (unavailable)
                </Link>
              </li>
              {selectedSlot.item.type === "unavailable" && (
                <li>
                  <button type="button" onClick={() => { handleRemoveUnavailable(selectedSlot.item.id); setSelectedSlot(null); }} className="text-red-600 hover:underline">
                    Remove this block
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "class" && (
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
                    <button type="button" onClick={() => handleDeleteClassOccurrence(selectedSlot.item.id)} className="text-red-600 hover:underline">
                      Delete this occurrence
                    </button>
                  </li>
                </>
              )}
              {selectedSlot.item.type === "pt_segment" && !selectedSlot.item.booked && (
                <li>
                  <Link href={`/admin/book-pt-for-member?block=${selectedSlot.item.blockId}&date=${selectedSlot.date}&time=${selectedSlot.item.start_time}`} className="text-brand-600 hover:underline block">
                    Assign PT (book for member)
                  </Link>
                </li>
              )}
              {selectedSlot.item.type === "pt_segment" && selectedSlot.item.booked && selectedSlot.item.booking_id != null && (
                <li>
                  <button type="button" onClick={() => handleCancelBlockBooking(selectedSlot.item.booking_id!)} className="text-red-600 hover:underline">
                    Cancel PT for client
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "open_booked" && selectedSlot.item.id != null && (
                <li>
                  <button type="button" onClick={() => handleCancelOpenBooking(selectedSlot.item.id)} className="text-red-600 hover:underline">
                    Cancel PT for client
                  </button>
                </li>
              )}
              {selectedSlot.item.type === "available" && (
                <li>
                  <Link href={`/admin/book-pt-for-member?date=${selectedSlot.date}&time=${selectedSlot.timeStr}`} className="text-brand-600 hover:underline block">
                    Book PT (no preference)
                  </Link>
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
