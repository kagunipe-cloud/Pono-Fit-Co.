"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GoalBoardRowView,
  formatGoalPercent,
  type GoalBoardRowData,
} from "@/components/goal-board/GoalBoardUI";

type GoalBoardPayload = {
  timezone: string;
  today: string;
  current: {
    week_start: string;
    week_end: string;
    macro_countable_days: number;
    rows: GoalBoardRowData[];
  };
  previous_leader: GoalBoardRowData | null;
};

export default function GoalBoardDisplay() {
  const router = useRouter();
  const [data, setData] = useState<GoalBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/goal-board")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (!json) return;
        if (json.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData(json);
      })
      .catch(() => setError("Could not load The Board."))
      .finally(() => setLoading(false));
  }, [router]);

  const rows = data?.current.rows ?? [];
  const topRows = useMemo(() => rows.slice(0, 20), [rows]);

  if (loading) return <p className="text-stone-500">Loading The Board…</p>;
  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!data) return null;

  return (
    <>
      <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">
        <p>
          Workouts update when a workout is <span className="font-medium text-stone-800">finished</span> (not just started). Past macro days
          lock at midnight in <span className="font-medium text-stone-800">{data.timezone}</span>; members can tap{" "}
          <span className="font-medium text-stone-800">Finish today&apos;s log</span> on today&apos;s journal to score early.
        </p>
        <p className="mt-2">
          <span className="font-medium text-stone-800">Workouts</span> need a weekly day goal saved on My Workouts.{" "}
          <span className="font-medium text-stone-800">Macros</span> need daily calorie + protein/fat/carb % goals on My Macros (weight
          goal alone doesn&apos;t score). Each macro day requires calories and all three macros within 15% of targets.
        </p>
        <p className="mt-1">
          Current week: <span className="font-medium text-stone-800">{data.current.week_start}</span> to{" "}
          <span className="font-medium text-stone-800">{data.current.week_end}</span>. Macro days checked so far:{" "}
          <span className="font-medium text-stone-800">{data.current.macro_countable_days}</span> day
          {data.current.macro_countable_days === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-stone-700 shadow-2xl">
        <div className="bg-stone-700 px-6 py-8 text-center text-white">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-[#9ef6b2]">Weekly Goals</div>
          <h2 className="text-4xl font-black uppercase tracking-tight sm:text-5xl">The Board</h2>
          <p className="mt-3 text-lg font-black uppercase tracking-wide">
            Last Week&apos;s Leader:{" "}
            <span className="text-[#9ef6b2]">
              {data.previous_leader
                ? `${data.previous_leader.display_name} (${formatGoalPercent(data.previous_leader.overall_percent)})`
                : "N/A"}
            </span>
          </p>
        </div>

        {topRows.length === 0 ? (
          <div className="bg-[#9ef6b2] px-6 py-10 text-center font-bold text-stone-900">
            No board data yet. Members will appear after setting goals or logging activity.
          </div>
        ) : (
          <div>
            {topRows.map((row, index) => (
              <GoalBoardRowView key={row.member_id} row={row} index={index} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
