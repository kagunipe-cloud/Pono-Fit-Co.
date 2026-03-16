"use client";

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 30_000;

export default function OccupancyCount() {
  const [occupancy, setOccupancy] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchOccupancy() {
      try {
        const res = await fetch("/api/occupancy");
        const data = (await res.json()) as { occupancy?: number | null };
        if (res.ok && data.occupancy != null) {
          setOccupancy(data.occupancy);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      }
    }

    fetchOccupancy();
    const interval = setInterval(fetchOccupancy, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center p-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 max-w-[250px] mx-auto">
      <h3 className="text-xs font-medium text-emerald-700 uppercase tracking-wider m-0">
        Coconut Count
      </h3>
      <div className="text-5xl font-bold text-emerald-900 my-2">
        {error ? "!" : occupancy ?? "—"}
      </div>
      <p className="text-sm text-emerald-600 m-0">Live Members On-Site</p>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${error ? "bg-amber-500" : "bg-emerald-500"}`}
          aria-hidden
        />
        <span className={`text-xs font-semibold ${error ? "text-amber-600" : "text-emerald-600"}`}>
          {error ? "Offline" : "Live"}
        </span>
      </div>
    </div>
  );
}
