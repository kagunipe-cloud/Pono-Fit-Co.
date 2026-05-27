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
      <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 px-4 py-6 text-center text-sm text-stone-300 shadow-lg">
        Loading your Goal Board…
      </div>
    );
  }

  if (!data?.row) {
    return (
      <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 shadow-lg">
        <div className="bg-stone-700 px-4 py-4 text-center text-white">
          <div className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-[#9ef6b2]">This Week</div>
          <h2 className="text-xl font-black uppercase tracking-tight">Goal Board</h2>
        </div>
        <div className="bg-[#9ef6b2] px-4 py-6 text-center text-sm font-bold text-stone-900">
          Set your weekly goals to appear on the board.
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
  const ranked = row.rank > 0 && total_ranked > 0;

  return (
    <div className="mb-6 overflow-hidden rounded-xl bg-stone-700 shadow-lg">
      <div className="bg-stone-700 px-4 py-4 text-center text-white">
        <div className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-[#9ef6b2]">This Week</div>
        <h2 className="text-xl font-black uppercase tracking-tight">Goal Board</h2>
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-stone-300">
          {week_start} – {week_end}
          {ranked ? (
            <>
              {" "}
              · <span className="text-[#9ef6b2]">#{row.rank}</span> of {total_ranked}
            </>
          ) : null}
        </p>
      </div>

      <GoalBoardRowView row={row} index={0} compact />

      <div className="bg-stone-800 px-4 py-2.5 text-center">
        <Link href="/member/weekly-goals" className="text-sm font-semibold text-[#9ef6b2] hover:text-white">
          Set / review goals →
        </Link>
      </div>
    </div>
  );
}
