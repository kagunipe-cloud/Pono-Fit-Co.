import { GYM_RECORD_PLACES, formatGymRecordLine, type GymRecordPlaceCell } from "@/lib/gym-records";

const PLACE_LABELS = ["1st", "2nd", "3rd"] as const;
const PLACE_MEDAL_CLASS = ["text-amber-300", "text-stone-100", "text-orange-300"] as const;

/** A standalone record card (no age/gender split) — just 1st / 2nd / 3rd. */
export function GymSpecialRecordCard({
  label,
  places,
  editing = false,
  onChange,
  variant = "admin",
}: {
  label: string;
  places: GymRecordPlaceCell[];
  editing?: boolean;
  onChange?: (placeIndex: number, field: "holder_name" | "record_value", value: string) => void;
  variant?: "admin" | "tv";
}) {
  const isTv = variant === "tv";

  return (
    <article className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-black shadow-2xl">
      <header
        className={`border-b-2 border-amber-400/70 bg-amber-500 text-center font-black uppercase tracking-[0.2em] text-stone-950 ${
          isTv ? "px-5 py-4 text-3xl sm:text-4xl" : "px-4 py-2.5 text-base sm:text-lg"
        }`}
      >
        {label}
      </header>
      <div className={isTv ? "space-y-3 px-6 py-6" : "space-y-2 px-4 py-4"}>
        {GYM_RECORD_PLACES.map((placeNum, placeIndex) => {
          const cell = places[placeIndex] ?? { holder_name: "", record_value: "" };
          const placeLabel = PLACE_LABELS[placeIndex] ?? String(placeNum);
          const medalClass = PLACE_MEDAL_CLASS[placeIndex] ?? "text-amber-300";

          if (editing && onChange) {
            return (
              <div key={placeNum} className="grid grid-cols-[2.5rem_1fr] items-start gap-2">
                <span className={`pt-2 font-black ${medalClass}`}>{placeLabel}</span>
                <div className="flex flex-col gap-1 sm:flex-row">
                  <input
                    type="text"
                    value={cell.holder_name}
                    onChange={(e) => onChange(placeIndex, "holder_name", e.target.value)}
                    placeholder="Name"
                    className="w-full rounded border border-stone-500 bg-stone-900 px-2 py-1 text-sm text-white placeholder:text-stone-500"
                  />
                  <input
                    type="text"
                    value={cell.record_value}
                    onChange={(e) => onChange(placeIndex, "record_value", e.target.value)}
                    placeholder="Record / score"
                    className="w-full rounded border border-stone-500 bg-stone-900 px-2 py-1 text-sm text-white placeholder:text-stone-500"
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
                isTv ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"
              } ${empty ? "opacity-40" : ""}`}
            >
              <span className={`mr-3 inline-block min-w-[2.5rem] ${medalClass}`}>{placeLabel}</span>
              <span className={empty ? "text-stone-500" : ""}>{line}</span>
            </p>
          );
        })}
      </div>
    </article>
  );
}
