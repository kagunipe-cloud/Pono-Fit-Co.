import { OpenCreditsClient } from "./OpenCreditsClient";

export const dynamic = "force-dynamic";

export default function OpenCreditsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Open Credits</h1>
        <p className="text-stone-500 mt-1">
          Class, PT, and pass-pack balances from ledgers and gifts — separate from scheduled class and PT bookings.
        </p>
      </header>
      <OpenCreditsClient />
    </div>
  );
}
