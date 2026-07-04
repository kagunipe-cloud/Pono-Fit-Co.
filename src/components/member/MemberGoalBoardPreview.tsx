"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GoalBoardProgressRing,
  goalMetricSubtext,
  type GoalBoardRowData,
} from "@/components/goal-board/GoalBoardUI";

type PreviewPayload = {
  week_start: string;
  week_end: string;
  total_ranked: number;
  row: GoalBoardRowData;
};

type AccessState = {
  subscribed: boolean;
  plan_id: number | null;
};

/** Positive demo scores for members without the board add-on. */
const DEMO_ROW: GoalBoardRowData = {
  rank: 0,
  member_id: "preview",
  display_name: "YOU",
  workouts: { hit: 3, target: 4, percent: 78 },
  macros: { hit: 5, target: 7, percent: 84 },
  personal_goal: { hit: 2, target: 3, percent: 67 },
  overall_percent: 76,
};

function PreviewRings({
  row,
  macrosLocked,
}: {
  row: GoalBoardRowData;
  macrosLocked: boolean;
}) {
  const dark = false;

  return (
    <div className="bg-[#9ef6b2] px-4 py-5 sm:px-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 items-center justify-items-center gap-4 sm:gap-5">
        <GoalBoardProgressRing
          label="Workouts"
          value={row.workouts.percent}
          subtext="Free to log"
          dark={dark}
          compact
        />
        <div className="relative flex flex-col items-center">
          <GoalBoardProgressRing
            label="Macros"
            value={row.macros.percent}
            subtext={macrosLocked ? "Board add-on" : goalMetricSubtext(row.macros)}
            dark={dark}
            compact
          />
          {macrosLocked ? (
            <span
              className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white"
              title="Nutrition tracking included with Weekly Goals Board"
              aria-hidden
            >
              🔒
            </span>
          ) : null}
        </div>
        <GoalBoardProgressRing
          label="Personal"
          value={row.personal_goal?.percent ?? null}
          subtext={goalMetricSubtext(row.personal_goal)}
          dark={dark}
          compact
        />
        <GoalBoardProgressRing
          label="Overall"
          value={row.overall_percent}
          subtext="Score"
          dark={dark}
          compact
        />
      </div>
      {macrosLocked ? (
        <p className="mt-4 text-center text-xs font-semibold text-stone-700">
          Workouts are free for every member. Our macro tracker &amp; TV board ranking are part of the
          Weekly Goals Board.
        </p>
      ) : null}
    </div>
  );
}

export default function MemberGoalBoardPreview() {
  const [access, setAccess] = useState<AccessState>({ subscribed: false, plan_id: null });
  const [live, setLive] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/member/goal-board")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok && json?.requires_subscription) {
          return {
            access: {
              subscribed: false,
              plan_id: typeof json.plan_id === "number" ? json.plan_id : null,
            },
            live: null,
          };
        }
        if (r.ok && json?.row) {
          return {
            access: { subscribed: true, plan_id: null },
            live: json as PreviewPayload,
          };
        }
        return { access: { subscribed: false, plan_id: null }, live: null };
      })
      .then(({ access, live }) => {
        setAccess(access);
        setLive(live);
      })
      .catch(() => {
        setAccess({ subscribed: false, plan_id: null });
        setLive(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const subscribeHref = access.plan_id
    ? `/member/memberships?plan=${access.plan_id}`
    : "/member/memberships";

  const row = access.subscribed && live?.row ? live.row : DEMO_ROW;
  const macrosLocked = !access.subscribed;

  if (loading) {
    return (
      <div className="mb-6 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="px-4 py-6 text-center text-sm text-stone-500">Loading weekly goals preview…</div>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 bg-gradient-to-r from-sky-50 to-violet-50 px-4 py-4 text-center sm:px-6">
        <h2 className="text-lg font-black uppercase tracking-tight text-stone-900 sm:text-xl">
          Weekly Smart Goals
        </h2>
        <p className="mt-2 text-sm font-semibold leading-snug text-stone-800 sm:text-base">
          Set Weekly Smart Goals, Track Your Nutrition, Workouts, and more
        </p>
        {access.subscribed && live ? (
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {live.week_start} – {live.week_end}
            {live.row.rank > 0 && live.total_ranked > 0 ? (
              <>
                {" "}
                · <span className="text-brand-700">#{live.row.rank}</span> of {live.total_ranked}
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-violet-700">Preview</p>
        )}
      </div>

      <PreviewRings row={row} macrosLocked={macrosLocked} />

      <div className="border-t border-stone-200 bg-stone-50 px-4 py-4 text-center sm:px-6">
        <p className="text-sm font-bold text-stone-800">
          <span className="text-stone-900">$10/month</span>
          <span className="mx-2 text-stone-400">·</span>
          <span className="text-stone-700">Free for PT clients (min 1 session/mo)</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={access.subscribed ? "/member/weekly-goals" : subscribeHref}
            className="inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {access.subscribed ? "Set your goals →" : "Join the Weekly Goals Board →"}
          </Link>
          <Link href="/member/workouts" className="text-sm font-semibold text-brand-700 hover:underline">
            Log workouts (free)
          </Link>
        </div>
      </div>
    </div>
  );
}
