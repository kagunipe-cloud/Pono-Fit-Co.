"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateOnlyInAppTz, formatInAppTz, formatWeekdayShortInAppTz } from "@/lib/app-timezone";

type JournalDay = { id: number; member_id: string; date: string; created_at: string };

function weekLabel(monday: string): string {
  const d = new Date(monday + "T12:00:00Z");
  const sun = new Date(d);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const monStr = formatInAppTz(d, { month: "short", day: "numeric" });
  const sunStr = formatInAppTz(sun, { month: "short", day: "numeric", year: "numeric" });
  return `${monStr} – ${sunStr}`;
}

function daySlug(d: string): string {
  return formatWeekdayShortInAppTz(d);
}

export default function MemberMacrosPage() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [daysByWeek, setDaysByWeek] = useState<Record<string, JournalDay[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const thisWeekMonday = (() => {
    const d = new Date();
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  })();
  const weekList = weeks.includes(thisWeekMonday) ? weeks : [thisWeekMonday, ...weeks];

  function fetchWeeks() {
    fetch("/api/member/journal/weeks")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return [];
        }
        return res.json();
      })
      .then((list: string[]) => setWeeks(Array.isArray(list) ? list : []))
      .catch(() => setWeeks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchWeeks();
  }, [router]);

  function fetchDaysForWeek(weekStart: string) {
    fetch(`/api/member/journal/days?week=${weekStart}`)
      .then((res) => res.ok ? res.json() : [])
      .then((list: JournalDay[]) => {
        setDaysByWeek((prev) => ({ ...prev, [weekStart]: list }));
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (selectedWeek) fetchDaysForWeek(selectedWeek);
  }, [selectedWeek]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Macros</h1>
      <p className="text-stone-600 text-sm mb-6">Daily Food Journal — log meals and snacks, track macros by day and by week.</p>

      <div className="mb-8">
        <Link
          href={`/member/macros/day/${today}`}
          className="block p-4 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-300 hover:bg-brand-50 transition-colors"
        >
          <span className="font-semibold text-stone-800">Today&apos;s Journal</span>
          <span className="block text-sm text-stone-500 mt-0.5">
            {formatDateOnlyInAppTz(today)}
          </span>
          <span className="text-brand-600 text-sm font-medium mt-1 inline-block">Open journal →</span>
        </Link>
      </div>

      <h2 className="text-sm font-medium text-stone-500 mb-3">Weeks</h2>
      {weekList.length === 0 ? (
        <p className="text-stone-500">Open today&apos;s journal and add a meal to get started.</p>
      ) : (
        <ul className="space-y-4">
          {weekList.map((monday) => (
            <li key={monday}>
              <button
                type="button"
                onClick={() => setSelectedWeek(selectedWeek === monday ? null : monday)}
                className="w-full text-left p-4 rounded-xl border border-stone-200 bg-white hover:bg-stone-50"
              >
                <span className="font-medium text-stone-800">{weekLabel(monday)}</span>
                {monday === thisWeekMonday && (
                  <span className="ml-2 text-xs font-medium text-brand-600">This week</span>
                )}
              </button>
              {selectedWeek === monday && (
                <ul className="mt-2 ml-2 pl-4 border-l-2 border-stone-200 space-y-1">
                  {daysByWeek[monday] === undefined ? (
                    <li className="text-stone-400 text-sm py-1">Loading…</li>
                  ) : (
                    (() => {
                      const days = daysByWeek[monday] ?? [];
                      const daySet = new Set(days.map((d) => d.date));
                      const weekDays = [];
                      for (let i = 0; i < 7; i++) {
                        const d = new Date(monday + "T12:00:00Z");
                        d.setUTCDate(d.getUTCDate() + i);
                        weekDays.push(d.toISOString().slice(0, 10));
                      }
                      return weekDays.map((date) => (
                        <li key={date}>
                          <Link
                            href={`/member/macros/day/${date}`}
                            className="block py-1.5 text-sm text-stone-700 hover:text-brand-600"
                          >
                            {daySlug(date)} {date} {daySet.has(date) ? "· logged" : ""}
                          </Link>
                        </li>
                      ));
                    })()
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8">
        <Link href="/member" className="text-brand-600 hover:underline text-sm">← Back to member home</Link>
      </p>
    </div>
  );
}
