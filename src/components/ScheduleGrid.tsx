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
};

type BlockSegment = { start_time: string; end_time: string; booked: boolean; member_name?: string; trainer: string };
type PtBlockWithSegments = { id: number; trainer: string; date: string; start_time: string; end_time: string; segments?: BlockSegment[] };

type UnavailableOccurrence = { id: number; trainer: string; date: string; start_time: string; end_time: string; description: string };

type CellItem =
  | { type: "class"; id: number; name: string; sub: string | null; occurrence_date: string; occurrence_time: string; booked_count: number; capacity: number }
  | { type: "unavailable"; id: number; description: string }
  | { type: "pt_segment"; blockId: number; trainer: string; start_time: string; end_time: string; booked: boolean; member_name?: string }
  | { type: "open_booked"; member_name?: string }
  | { type: "available" };

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

type ScheduleGridProps = { variant: "member" | "master" | "trainer"; trainerMemberId?: string | null; trainerDisplayName?: string | null };

export default function ScheduleGrid({ variant, trainerMemberId, trainerDisplayName }: ScheduleGridProps) {
  const searchParams = useSearchParams();
  const tz = useAppTimezone();
  const productId = searchParams.get("product")?.trim() || null;
  const [weekStartStr, setWeekStartStr] = useState<string>(() => getInitialWeekStartStr(tz));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableOccurrence[]>([]);
  const [ptBlocks, setPtBlocks] = useState<PtBlockWithSegments[]>([]);
  const [openBookings, setOpenBookings] = useState<{ occurrence_date: string; start_time: string; duration_minutes: number; member_name?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const bookPtQuery = productId ? `&product=${encodeURIComponent(productId)}` : "";
  const isMaster = variant === "master";
  const isTrainer = variant === "trainer";
  const effectiveTrainerId = trainerMemberId ?? null;

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
  }, [fromStr, toStr, effectiveTrainerId]);

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
    for (const date of dayDates) {
      for (let slotMin = TIME_SLOT_MIN; slotMin < TIME_SLOT_MAX; slotMin += SLOT_MINUTES) {
        const key = `${date}-${slotMin}`;
        const classAtSlot = occurrences.find((o) => {
          if (o.occurrence_date !== date) return false;
          const min = parseTimeToMinutes(o.occurrence_time);
          const classSlot = Math.floor((min - TIME_SLOT_MIN) / SLOT_MINUTES) * SLOT_MINUTES + TIME_SLOT_MIN;
          return classSlot === slotMin;
        });
        if (classAtSlot) {
          map.set(key, {
            type: "class",
            id: classAtSlot.id,
            name: classAtSlot.class_name,
            sub: classAtSlot.instructor,
            occurrence_date: classAtSlot.occurrence_date,
            occurrence_time: classAtSlot.occurrence_time,
            booked_count: classAtSlot.booked_count,
            capacity: classAtSlot.capacity,
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
        const PT_SPILLOVER = 15;
        const openBookingAtSlot = openBookings.find((b) => {
          if (b.occurrence_date !== date) return false;
          const startMin = parseTimeToMinutes(b.start_time);
          const endMin = startMin + b.duration_minutes + PT_SPILLOVER;
          return slotOverlaps(slotMin, startMin, endMin);
        });
        if (openBookingAtSlot) {
          map.set(key, { type: "open_booked", ...(openBookingAtSlot.member_name != null && { member_name: openBookingAtSlot.member_name }) });
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
        map.set(key, { type: "available" });
      }
    }
    return map;
  }, [dayDates, occurrences, unavailable, openBookings, ptBlocks, isTrainer, trainerDisplayName]);

  function prevWeek() {
    setWeekStartStr((s) => addDaysToDateStr(s, -7));
  }
  function nextWeek() {
    setWeekStartStr((s) => addDaysToDateStr(s, 7));
  }
  function goToToday() {
    setWeekStartStr(getInitialWeekStartStr(tz));
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
                {timeSlots.map((slotMin) => (
                  <tr key={slotMin} className="border-b border-stone-100 last:border-b-0">
                    <td className="align-top py-1 px-1 sm:px-2 text-xs text-stone-500 border-r border-stone-200 whitespace-nowrap">{formatTime(slotMin)}</td>
                    {dayDates.map((date) => {
                      const key = `${date}-${slotMin}`;
                      const item = grid.get(key) ?? ({ type: "available" } as CellItem);
                      const timeStr = timeMinutesToTimeString(slotMin);
                      return (
                        <td key={date} className="align-top p-1 min-w-[100px] sm:min-w-[120px] border-r border-stone-100 last:border-r-0">
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
                              className="rounded-lg bg-stone-400 min-h-[2.5rem] flex items-center px-2 py-1.5 text-stone-100"
                              title={isMaster ? item.description : "Unavailable"}
                            >
                              {isMaster && item.description ? (
                                <span className="text-xs truncate block w-full" title={item.description}>{item.description}</span>
                              ) : null}
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
                            <div className={`rounded-lg border px-2 py-1.5 min-h-[2.5rem] ${item.booked ? "bg-stone-400 border-stone-500" : "bg-white border-2 border-brand-500 hover:border-brand-600"}`}>
                              {item.booked ? (isMaster || isTrainer ? (
                                <span className="text-xs text-stone-200 block truncate" title={item.member_name ?? "Booked"}>
                                  {item.member_name ?? "Booked"}
                                </span>
                              ) : null) : (
                                <>
                                  <span className="text-xs font-medium text-stone-800">Available</span>
                                  {!isTrainer && <span className="text-xs text-stone-500 block truncate">{item.trainer}</span>}
                                  {!isTrainer && (
                                    <Link href={variant === "master" ? `/admin/book-pt-for-member?block=${item.blockId}&date=${date}&time=${item.start_time}` : `/member/book-pt?block=${item.blockId}&date=${date}${bookPtQuery || ""}`} className="text-xs text-brand-600 hover:underline mt-0.5 inline-block" onClick={(e) => e.stopPropagation()}>Book</Link>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {item.type === "available" && (
                            <div className="rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2 py-1.5 min-h-[2.5rem] flex items-center justify-center transition-colors">
                              {isTrainer ? (
                                <span className="text-xs text-stone-500">—</span>
                              ) : (
                                <Link href={variant === "master" ? `/admin/book-pt-for-member?date=${date}&time=${timeStr}` : `/member/book-pt?date=${date}&time=${timeStr}${bookPtQuery || ""}`} className="text-xs text-brand-700 hover:text-brand-800 hover:underline">Available</Link>
                              )}
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
    </div>
  );
}
