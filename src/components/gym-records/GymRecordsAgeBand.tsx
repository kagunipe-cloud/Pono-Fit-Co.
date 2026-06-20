import {
  GYM_RECORD_EVENTS,
  GYM_RECORD_PLACES,
  formatGymRecordLine,
  type GymRecordAgeBracket,
  type GymRecordEventKey,
  type GymRecordGender,
  type GymRecordsGrid,
} from "@/lib/gym-records";

const PLACE_LABELS = ["1st", "2nd", "3rd"] as const;
// Bright gold / silver / bronze — high contrast on the solid black card body.
const PLACE_MEDAL_CLASS = ["text-amber-300", "text-stone-100", "text-orange-300"] as const;

// Solid black card bodies + vivid header banners so white text reads from across a glary,
// small TV. Bright borders separate each card from the age-band background.
const LIFT_THEMES: Record<
  GymRecordEventKey,
  { card: string; header: string; border: string; accent: string; divider: string }
> = {
  bench_press: {
    card: "bg-black",
    header: "bg-red-600 text-white",
    border: "border-red-400",
    accent: "text-red-200",
    divider: "divide-stone-600",
  },
  squat: {
    card: "bg-black",
    header: "bg-blue-600 text-white",
    border: "border-blue-400",
    accent: "text-blue-200",
    divider: "divide-stone-600",
  },
  deadlift: {
    card: "bg-black",
    header: "bg-violet-600 text-white",
    border: "border-violet-400",
    accent: "text-violet-200",
    divider: "divide-stone-600",
  },
  mile_run: {
    card: "bg-black",
    header: "bg-sky-600 text-white",
    border: "border-sky-400",
    accent: "text-sky-200",
    divider: "divide-stone-600",
  },
  row_2000m: {
    card: "bg-black",
    header: "bg-cyan-600 text-white",
    border: "border-cyan-400",
    accent: "text-cyan-200",
    divider: "divide-stone-600",
  },
  pullups: {
    card: "bg-black",
    header: "bg-amber-400 text-stone-950",
    border: "border-amber-300",
    accent: "text-amber-200",
    divider: "divide-stone-600",
  },
  plank: {
    card: "bg-black",
    header: "bg-orange-500 text-stone-950",
    border: "border-orange-300",
    accent: "text-orange-200",
    divider: "divide-stone-600",
  },
  wall_sit: {
    card: "bg-black",
    header: "bg-rose-600 text-white",
    border: "border-rose-400",
    accent: "text-rose-200",
    divider: "divide-stone-600",
  },
};

type DraftField = "holder_name" | "record_value";

type OnDraftChange = (
  age: GymRecordAgeBracket,
  gender: GymRecordGender,
  eventKey: GymRecordEventKey,
  placeIndex: number,
  field: DraftField,
  value: string
) => void;

function GenderHalf({
  gender,
  places,
  eventKey,
  age,
  editing,
  dark,
  isTv,
  compact,
  onDraftChange,
  theme,
}: {
  gender: GymRecordGender;
  places: { holder_name: string; record_value: string }[];
  eventKey: GymRecordEventKey;
  age: GymRecordAgeBracket;
  editing: boolean;
  dark: boolean;
  isTv: boolean;
  compact: boolean;
  onDraftChange?: OnDraftChange;
  theme: (typeof LIFT_THEMES)[GymRecordEventKey];
}) {
  const genderLabel = gender === "men" ? "Men" : "Women";

  return (
    <div className={compact ? "px-2.5 py-2" : isTv ? "px-3.5 py-2.5" : "px-2.5 py-2"}>
      <p
        className={`mb-1.5 text-center font-black uppercase tracking-[0.15em] ${theme.accent} ${
          isTv ? (compact ? "text-[0.65rem]" : "text-xs") : "text-[0.65rem]"
        }`}
      >
        {genderLabel}
      </p>
      <div className={compact ? "space-y-0.5" : "space-y-1"}>
        {GYM_RECORD_PLACES.map((placeNum, placeIndex) => {
          const cell = places[placeIndex] ?? { holder_name: "", record_value: "" };
          const placeLabel = PLACE_LABELS[placeIndex] ?? String(placeNum);
          const medalClass = PLACE_MEDAL_CLASS[placeIndex] ?? theme.accent;

          if (editing && onDraftChange) {
            return (
              <div key={placeNum} className="grid grid-cols-[2rem_1fr] items-start gap-1">
                <span className={`pt-1 text-[0.65rem] font-black ${medalClass}`}>{placeLabel}</span>
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={cell.holder_name}
                    onChange={(e) =>
                      onDraftChange(age, gender, eventKey, placeIndex, "holder_name", e.target.value)
                    }
                    placeholder="Name"
                    className={`rounded border px-2 py-1 text-xs ${
                      dark
                        ? "border-stone-600 bg-stone-900 text-white placeholder:text-stone-500"
                        : "border-stone-500 bg-white text-stone-900"
                    }`}
                  />
                  <input
                    type="text"
                    value={cell.record_value}
                    onChange={(e) =>
                      onDraftChange(age, gender, eventKey, placeIndex, "record_value", e.target.value)
                    }
                    placeholder="Record"
                    className={`rounded border px-2 py-1 text-xs ${
                      dark
                        ? "border-stone-600 bg-stone-900 text-white placeholder:text-stone-500"
                        : "border-stone-500 bg-white text-stone-900"
                    }`}
                  />
                </div>
              </div>
            );
          }

          const line = formatGymRecordLine(cell.holder_name, cell.record_value);
          const empty = line === "—";

          return (
            <p
              key={placeNum}
              className={`font-black uppercase leading-snug text-white ${
                isTv
                  ? compact
                    ? "text-xs"
                    : "text-sm sm:text-base"
                  : "text-[0.7rem] sm:text-xs"
              } ${empty ? "opacity-40" : ""}`}
            >
              <span className={`mr-1.5 inline-block min-w-[1.75rem] ${medalClass}`}>
                {placeLabel}
              </span>
              <span className={empty ? "text-stone-500" : "text-white"}>{line}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

/** One lift tile — women (left) and men (right), split side by side. */
function UnifiedLiftCard({
  eventKey,
  label,
  age,
  records,
  editing,
  draft,
  onDraftChange,
  dark,
  isTv,
  compact,
}: {
  eventKey: GymRecordEventKey;
  label: string;
  age: GymRecordAgeBracket;
  records: GymRecordsGrid;
  editing: boolean;
  draft?: GymRecordsGrid;
  onDraftChange?: OnDraftChange;
  dark: boolean;
  isTv: boolean;
  compact: boolean;
}) {
  const theme = LIFT_THEMES[eventKey];
  const grid = editing && draft ? draft : records;

  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-xl border-2 shadow-lg ${theme.card} ${theme.border}`}
    >
      <header
        className={`shrink-0 border-b px-3 py-2 text-center font-black uppercase tracking-wide ${theme.header} ${
          isTv ? (compact ? "text-xs" : "text-sm") : "text-xs"
        }`}
      >
        {label}
      </header>

      <div className={`grid flex-1 grid-cols-2 divide-x-2 ${theme.divider}`}>
        <GenderHalf
          gender="women"
          places={grid[age].women[eventKey]}
          eventKey={eventKey}
          age={age}
          editing={editing}
          dark={dark}
          isTv={isTv}
          compact={compact}
          onDraftChange={onDraftChange}
          theme={theme}
        />
        <GenderHalf
          gender="men"
          places={grid[age].men[eventKey]}
          eventKey={eventKey}
          age={age}
          editing={editing}
          dark={dark}
          isTv={isTv}
          compact={compact}
          onDraftChange={onDraftChange}
          theme={theme}
        />
      </div>
    </article>
  );
}

export function GymRecordsAgeBand({
  age,
  index,
  records,
  editing = false,
  draft,
  onDraftChange,
  variant = "admin",
  compact = false,
}: {
  age: GymRecordAgeBracket;
  index: number;
  records: GymRecordsGrid;
  editing?: boolean;
  draft?: GymRecordsGrid;
  onDraftChange?: OnDraftChange;
  variant?: "admin" | "tv";
  compact?: boolean;
}) {
  const dark = index % 2 === 1;
  const bg = dark ? "bg-black text-[#9ef6b2]" : "bg-[#9ef6b2] text-stone-950";
  const isTv = variant === "tv";

  return (
    <div
      className={`${bg} ${
        isTv ? (compact ? "px-3 py-3" : "px-4 py-4") : "px-4 py-6 sm:px-8"
      }`}
    >
      <div
        className={`text-center font-black uppercase tracking-tight ${
          dark ? "text-white" : "text-stone-900"
        } ${isTv ? (compact ? "mb-2 text-2xl" : "mb-3 text-3xl sm:text-4xl") : "mb-4 text-3xl sm:text-4xl"}`}
      >
        {age}
      </div>

      <div
        className={`grid gap-2.5 ${
          isTv ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
        }`}
      >
        {GYM_RECORD_EVENTS.map((ev) => (
          <UnifiedLiftCard
            key={ev.key}
            eventKey={ev.key}
            label={ev.label}
            age={age}
            records={records}
            editing={editing}
            draft={draft}
            onDraftChange={onDraftChange}
            dark={dark}
            isTv={isTv}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
