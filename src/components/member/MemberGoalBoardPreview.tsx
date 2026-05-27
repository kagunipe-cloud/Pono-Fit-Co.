"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GoalBoardRowView, type GoalBoardRowData } from "@/components/goal-board/GoalBoardUI";

type PreviewPayload = {
  week_start: string;
  week_end: string;
  total_ranked: number;
  row: GoalBoardRowData;
};

function ComingSoonBanner() {
  return (
    <div className="border-b border-amber-500/40 bg-amber-400 px-4 py-3 text-center">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-stone-950">Coming Soon</p>
      <p className="mt-1 text-xs font-semibold leading-snug text-stone-900">
        Live scoring and rankings are on the way. Set your goals now — you&apos;ll be ready when we flip the switch.
      </p>
    </div>
  );
}

function WeeklyGoalsHeader({
  weekStart,
  weekEnd,
  rank,
  totalRanked,
}: {
  weekStart?: string;
  weekEnd?: string;
  rank?: number;
  totalRanked?: number;
}) {
  const ranked = rank != null && rank > 0 && (totalRanked ?? 0) > 0;

  return (
    <div className="bg-stone-700 px-4 py-4 text-center text-white">
      <h2 className="text-xl font-black uppercase tracking-tight">Weekly Goals</h2>
      {weekStart && weekEnd ? (
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-stone-300">
          {weekStart} – {weekEnd}
          {ranked ? (
            <>
              {" "}
              · <span className="text-[#9ef6b2]">#{rank}</span> of {totalRanked}
            </>
          ) : null}
        </p>
      ) : (
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-stone-400">Preview</p>
      )}
    </div>
  );
}

export default function MemberGoalBoardPreview() {
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/member/goal-board")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 shadow-lg">
        <ComingSoonBanner />
        <div className="px-4 py-6 text-center text-sm text-stone-300">Loading your weekly goals…</div>
      </div>
    );
  }

  if (!data?.row) {
    return (
      <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 shadow-lg">
        <ComingSoonBanner />
        <WeeklyGoalsHeader />
        <div className="bg-[#9ef6b2] px-4 py-6 text-center text-sm font-bold text-stone-900">
          Set your weekly goals to get a head start before launch.
        </div>
        <div className="bg-stone-800 px-4 py-2.5 text-center">
          <Link href="/member/weekly-goals" className="text-sm font-semibold text-[#9ef6b2] hover:text-white">
            Set weekly goals →
          </Link>
        </div>
      </div>
    );
  }

  const { row, total_ranked, week_start, week_end } = data;

  return (
    <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 shadow-lg">
      <ComingSoonBanner />
      <WeeklyGoalsHeader weekStart={week_start} weekEnd={week_end} rank={row.rank} totalRanked={total_ranked} />

      <div className="relative">
        <GoalBoardRowView row={row} index={0} compact />
        <div
          className="pointer-events-none absolute inset-0 bg-stone-950/10"
          aria-hidden
        />
      </div>

      <div className="bg-stone-800 px-4 py-2.5 text-center">
        <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-stone-400">Preview only</p>
        <Link href="/member/weekly-goals" className="text-sm font-semibold text-[#9ef6b2] hover:text-white">
          Set / review goals →
        </Link>
      </div>
    </div>
  );
}
