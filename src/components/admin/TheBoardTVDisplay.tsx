"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GymRecordsAgeBand } from "@/components/gym-records/GymRecordsAgeBand";
import { GoalBoardRowView, type GoalBoardRowData } from "@/components/goal-board/GoalBoardUI";
import {
  GYM_RECORD_TV_PAGES,
  emptyGymRecordsGrid,
  type GymRecordAgeBracket,
  type GymRecordsGrid,
} from "@/lib/gym-records";

const ROTATE_MS = 28_000;

type TvPage =
  | { kind: "records"; ages: readonly GymRecordAgeBracket[] }
  | { kind: "goals" };

const TV_PAGES: TvPage[] = [
  ...GYM_RECORD_TV_PAGES.map((ages) => ({ kind: "records" as const, ages })),
  { kind: "goals" as const },
];

export default function TheBoardTVDisplay({ token }: { token?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const manualPage = searchParams.get("page");
  const pauseRotation = manualPage !== null;

  const [records, setRecords] = useState<GymRecordsGrid>(emptyGymRecordsGrid());
  const [goalRows, setGoalRows] = useState<GoalBoardRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(() => {
    const n = Number(manualPage);
    if (n >= 1 && n <= TV_PAGES.length) return n - 1;
    return 0;
  });

  const load = useCallback(() => {
    setError(null);

    // Public (tokenized) feed for the always-on TV — no login required.
    if (token) {
      fetch(`/api/public/board-tv?token=${encodeURIComponent(token)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!json || json.error) {
            setError(json?.error ?? "Could not load The Board.");
            return;
          }
          setRecords(json.records as GymRecordsGrid);
          setGoalRows(((json.goalRows ?? []) as GoalBoardRowData[]).slice(0, 10));
        })
        .catch(() => setError("Could not load The Board."))
        .finally(() => setLoading(false));
      return;
    }

    Promise.all([
      fetch("/api/admin/gym-records").then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      }),
      fetch("/api/admin/goal-board").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([recordsJson, goalsJson]) => {
        if (recordsJson) {
          if (recordsJson.error) setError(recordsJson.error);
          else setRecords(recordsJson.records as GymRecordsGrid);
        }
        if (goalsJson && !goalsJson.error) {
          const rows = (goalsJson.current?.rows ?? []) as GoalBoardRowData[];
          setGoalRows(rows.slice(0, 10));
        }
      })
      .catch(() => setError("Could not load The Board."))
      .finally(() => setLoading(false));
  }, [router, token]);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 5 * 60_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  // Keep the screen awake on the always-on TV. Re-acquire when the tab becomes visible
  // again (browsers auto-release the lock on visibility loss).
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    type WakeLockNavigator = { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } };
    let sentinel: WakeLockSentinel | null = null;

    const request = async () => {
      try {
        const wl = (navigator as unknown as WakeLockNavigator).wakeLock;
        if (wl) sentinel = await wl.request("screen");
      } catch {
        /* unsupported or denied — TV OS screensaver setting is the fallback */
      }
    };

    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const n = Number(manualPage);
    if (n >= 1 && n <= TV_PAGES.length) {
      setPageIndex(n - 1);
    }
  }, [manualPage]);

  useEffect(() => {
    if (pauseRotation) return;
    const timer = window.setInterval(() => {
      setPageIndex((prev) => (prev + 1) % TV_PAGES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [pauseRotation]);

  const page = useMemo(() => TV_PAGES[pageIndex] ?? TV_PAGES[0]!, [pageIndex]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-950 text-[#9ef6b2]">
        <p className="text-lg font-bold uppercase tracking-wide">Loading The Board…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-950 p-6 text-center text-red-300">
        <p>{error}</p>
      </div>
    );
  }

  const isGoals = page.kind === "goals";

  return (
    <div className="min-h-[100dvh] bg-stone-950 text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1080px] flex-col">
        <header className="shrink-0 border-b border-stone-700 bg-gradient-to-b from-stone-800 to-stone-900 px-5 py-6 text-center">
          <div className="mb-3 flex justify-center">
            <Image src="/Lei_Logos.png" alt="Pono Fit Co." width={220} height={56} className="h-11 w-auto" priority />
          </div>
          <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">
            {isGoals ? "Weekly Goals" : "Gym Records"}
          </h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.25em] text-[#9ef6b2]">
            {isGoals ? "Top 10 This Week" : `Page ${pageIndex + 1} of ${TV_PAGES.length}`}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto">
          {page.kind === "records" ? (
            page.ages.map((age, index) => (
              <GymRecordsAgeBand
                key={age}
                age={age}
                index={index}
                records={records}
                variant="tv"
                compact={page.ages.length > 1}
              />
            ))
          ) : goalRows.length === 0 ? (
            <div className="flex h-full items-center justify-center bg-[#9ef6b2] px-6 py-16 text-center font-black uppercase text-stone-900">
              No goal data yet this week.
            </div>
          ) : (
            <div>
              {goalRows.map((row, index) => (
                <GoalBoardRowView key={row.member_id} row={row} index={index} compact />
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-stone-700 bg-stone-900 px-5 py-4">
          <div className="flex items-center justify-center gap-2">
            {TV_PAGES.map((p, i) => (
              <span
                key={i}
                className={`rounded-full ${
                  p.kind === "goals" ? "h-2.5 w-5" : "h-2.5 w-2.5"
                } ${i === pageIndex ? "bg-[#9ef6b2]" : "bg-stone-500"}`}
                aria-hidden
              />
            ))}
          </div>
          <div className="mt-3 flex justify-center">
            <Image src="/Lei_Logos.png" alt="" width={160} height={40} className="h-8 w-auto opacity-90" />
          </div>
        </footer>
      </div>
    </div>
  );
}
