import Link from "next/link";
import { PtBookingsClient } from "./PtBookingsClient";

export const dynamic = "force-dynamic";

export default function PtBookingsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            PT Bookings
          </h1>
          <p className="text-stone-500 mt-1">
            All PT sessions — active (soonest first, credits at bottom) and fulfilled (most recent first)
          </p>
        </div>
        <Link
          href="/pt-bookings/generate-recurring"
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 shrink-0"
        >
          Generate Recurring PT
        </Link>
      </header>
      <PtBookingsClient />
    </div>
  );
}
