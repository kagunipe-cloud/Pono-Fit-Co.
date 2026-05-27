export type GoalMetric = {
  hit: number;
  target: number;
  percent: number | null;
};

export type GoalBoardRowData = {
  rank: number;
  member_id: string;
  display_name: string;
  workouts: GoalMetric;
  macros: GoalMetric;
  personal_goal: GoalMetric | null;
  overall_percent: number | null;
};

export function formatGoalPercent(value: number | null): string {
  return value == null ? "N/A" : `${value}%`;
}

export function goalMetricSubtext(metric: GoalMetric | null): string {
  if (!metric || metric.percent == null) return "Not set";
  return `${metric.hit}/${metric.target}`;
}

export function GoalBoardProgressRing({
  label,
  value,
  subtext,
  dark,
  compact = false,
}: {
  label: string;
  value: number | null;
  subtext: string;
  dark: boolean;
  compact?: boolean;
}) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const ring = value == null ? "#888" : "#98f8b1";
  const track = dark ? "#737373" : "#777";
  const sizeClass = compact ? "h-14 w-14" : "h-20 w-20";
  const insetClass = compact ? "inset-2" : "inset-3";
  const percentClass = compact ? "text-sm" : "text-lg";
  const subtextClass = compact ? "text-[0.5rem]" : "text-[0.58rem]";
  const labelClass = compact ? "text-[0.55rem]" : "text-[0.65rem]";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`text-center ${labelClass} font-black uppercase leading-none tracking-wide ${dark ? "text-[#9ef6b2]" : "text-stone-950"}`}
      >
        {label}
      </div>
      <div
        className={`relative ${sizeClass} rounded-full`}
        style={{ background: `conic-gradient(${ring} ${pct * 3.6}deg, ${track} 0deg)` }}
        aria-label={`${label}: ${formatGoalPercent(value)}`}
      >
        <div
          className={`absolute ${insetClass} rounded-full ${dark ? "bg-black" : "bg-[#9ef6b2]"} flex flex-col items-center justify-center`}
        >
          <span className={`${percentClass} font-black ${dark ? "text-[#9ef6b2]" : "text-stone-950"}`}>
            {formatGoalPercent(value)}
          </span>
          <span className={`${subtextClass} font-bold ${dark ? "text-stone-300" : "text-stone-700"}`}>{subtext}</span>
        </div>
      </div>
    </div>
  );
}

export function GoalBoardRowView({
  row,
  index,
  compact = false,
}: {
  row: GoalBoardRowData;
  index: number;
  compact?: boolean;
}) {
  const dark = index % 2 === 1;
  const rankLabel = row.rank > 0 ? `${row.rank}.` : "—";
  const paddingClass = compact ? "px-3 py-4 sm:px-4" : "px-5 py-7";
  const nameClass = compact ? "text-base sm:text-lg" : "text-lg";
  const gridClass = compact
    ? "grid grid-cols-[minmax(5rem,1fr)_repeat(4,minmax(3.25rem,0.75fr))] items-center gap-2 sm:gap-3"
    : "grid grid-cols-[minmax(8rem,1.2fr)_repeat(4,minmax(4.5rem,0.8fr))] items-center gap-4";

  return (
    <div className={`${dark ? "bg-black text-[#9ef6b2]" : "bg-[#9ef6b2] text-stone-950"} ${paddingClass}`}>
      <div className={gridClass}>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 sm:gap-2">
            <span className={`${nameClass} font-black`}>{rankLabel}</span>
            <span className={`truncate ${nameClass} font-black uppercase tracking-wide`}>{row.display_name}</span>
          </div>
        </div>
        <GoalBoardProgressRing
          label="Workouts"
          value={row.workouts.percent}
          subtext={goalMetricSubtext(row.workouts)}
          dark={dark}
          compact={compact}
        />
        <GoalBoardProgressRing
          label="Macros"
          value={row.macros.percent}
          subtext={goalMetricSubtext(row.macros)}
          dark={dark}
          compact={compact}
        />
        <GoalBoardProgressRing
          label={compact ? "Personal" : "Personal Goal"}
          value={row.personal_goal?.percent ?? null}
          subtext={goalMetricSubtext(row.personal_goal)}
          dark={dark}
          compact={compact}
        />
        <GoalBoardProgressRing
          label={compact ? "Overall" : "Overall Score"}
          value={row.overall_percent}
          subtext="Avg"
          dark={dark}
          compact={compact}
        />
      </div>
    </div>
  );
}
