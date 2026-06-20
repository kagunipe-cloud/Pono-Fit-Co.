"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GymRecordsAgeBand } from "@/components/gym-records/GymRecordsAgeBand";
import { GymSpecialRecordCard } from "@/components/gym-records/GymSpecialRecordCard";
import { GoalBoardRowView, type GoalBoardRowData } from "@/components/goal-board/GoalBoardUI";
import {
  GYM_RECORD_TV_PAGES,
  GYM_SPECIAL_RECORDS,
  emptyGymRecordsGrid,
  emptyGymSpecialRecordsGrid,
  type GymRecordAgeBracket,
  type GymRecordsGrid,
  type GymSpecialRecordsGrid,
} from "@/lib/gym-records";

const ROTATE_MS = 28_000;

/** Fixed portrait canvas width the board lays out at; the stage scales it to fit any screen. */
const DESIGN_WIDTH = 1080;
const MAX_SCALE = 4;

type TvPage =
  | { kind: "records"; ages: readonly GymRecordAgeBracket[] }
  | { kind: "special" }
  | { kind: "goals" };

const TV_PAGES: TvPage[] = [
  ...GYM_RECORD_TV_PAGES.map((ages) => ({ kind: "records" as const, ages })),
  { kind: "special" as const },
  { kind: "goals" as const },
];

export default function TheBoardTVDisplay({ token }: { token?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const manualPage = searchParams.get("page");
  const pauseRotation = manualPage !== null;

  // Optional on-screen rotation for TVs mounted sideways (Fire TV can't rotate itself).
  // ?rotate=cw (90° clockwise) or ?rotate=ccw (90° counter-clockwise).
  const rotateParam = (searchParams.get("rotate") ?? "").toLowerCase();
  const rotation =
    rotateParam === "cw" || rotateParam === "90" || rotateParam === "right"
      ? 90
      : rotateParam === "ccw" || rotateParam === "270" || rotateParam === "left"
        ? -90
        : 0;

  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const [records, setRecords] = useState<GymRecordsGrid>(emptyGymRecordsGrid());
  const [special, setSpecial] = useState<GymSpecialRecordsGrid>(emptyGymSpecialRecordsGrid());
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
          if (json.special) setSpecial(json.special as GymSpecialRecordsGrid);
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
          if (recordsJson.error) {
            setError(recordsJson.error);
          } else {
            setRecords(recordsJson.records as GymRecordsGrid);
            if (recordsJson.special) setSpecial(recordsJson.special as GymSpecialRecordsGrid);
          }
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

  // Auto-fit: scale the fixed-width board so the whole page always fills the screen
  // without scrolling, on any TV size / browser, and accounting for rotation.
  useLayoutEffect(() => {
    const recompute = () => {
      const content = contentRef.current;
      if (!content) return;
      const cw = content.offsetWidth;
      const ch = content.offsetHeight;
      if (!cw || !ch) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // When rotated 90°, the content's width axis spans the screen's height and vice versa.
      const availForWidth = rotation ? vh : vw;
      const availForHeight = rotation ? vw : vh;
      const next = Math.min(availForWidth / cw, availForHeight / ch, MAX_SCALE);
      if (next > 0 && Number.isFinite(next)) setScale(next);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [rotation, pageIndex, loading, records, special, goalRows]);

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

  const title =
    page.kind === "goals" ? "Weekly Goals" : page.kind === "special" ? "Fish Game" : "Gym Records";
  const subtitle =
    page.kind === "goals"
      ? "Top 10 This Week"
      : page.kind === "special"
        ? "Hall of Fame"
        : `Page ${pageIndex + 1} of ${TV_PAGES.length}`;

  const body = (
    <div className="bg-stone-950 text-white">
      <div className="flex w-full flex-col">
        <header className="shrink-0 border-b border-stone-700 bg-gradient-to-b from-stone-800 to-stone-900 px-5 py-6 text-center">
          <div className="mb-3 flex justify-center">
            <Image src="/Lei_Logos.png" alt="Pono Fit Co." width={220} height={56} className="h-11 w-auto" priority />
          </div>
          <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.25em] text-[#9ef6b2]">{subtitle}</p>
        </header>

        <div className="flex-1">
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
          ) : page.kind === "special" ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-stone-950 px-6 py-10">
              {GYM_SPECIAL_RECORDS.map((rec) => (
                <div key={rec.key} className="w-full max-w-xl">
                  <GymSpecialRecordCard label={rec.label} places={special[rec.key]} variant="tv" />
                </div>
              ))}
            </div>
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
                  p.kind === "records" ? "h-2.5 w-2.5" : "h-2.5 w-5"
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

  // Stage: center the fixed-width board, rotate for sideways TVs, and scale to fill the screen.
  return (
    <div ref={stageRef} className="fixed inset-0 overflow-hidden bg-stone-950">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <div ref={contentRef} style={{ width: DESIGN_WIDTH }}>
          {body}
        </div>
      </div>
    </div>
  );
}
