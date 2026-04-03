import { ClassBookingsClient } from "./ClassBookingsClient";

export const dynamic = "force-dynamic";

export default function ClassBookingsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
          Class Bookings
        </h1>
        <p className="text-stone-500 mt-1">
          Scheduled class sessions — active (soonest first) and fulfilled (most recent first). Open class credits are under Bookings → Open Credits.
        </p>
      </header>
      <ClassBookingsClient />
    </div>
  );
}
