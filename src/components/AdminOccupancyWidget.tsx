"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AdminOccupancyWidget() {
  const router = useRouter();
  const [occupancy, setOccupancy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"add" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fetchOccupancy() {
    fetch("/api/occupancy")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data && typeof data.occupancy === "number") setOccupancy(data.occupancy);
        else setOccupancy(0);
        setError(null);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchOccupancy();
    const interval = setInterval(fetchOccupancy, 30_000);
    return () => clearInterval(interval);
  }, [router]);

  async function handleAction(action: "add" | "remove") {
    setActionLoading(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setOccupancy(data.occupancy ?? occupancy ?? 0);
    } catch {
      setError("Failed");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mb-6 flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/50">
      <div className="text-center p-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 min-w-[200px]">
        <h3 className="text-xs font-medium text-emerald-700 uppercase tracking-wider m-0">
          Coconut Count
        </h3>
        <div className="text-4xl font-bold text-emerald-900 my-1">
          {loading ? "—" : occupancy ?? "—"}
        </div>
        <p className="text-sm text-emerald-600 m-0">Live Members On-Site</p>
        <div className="mt-1.5 flex items-center justify-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
          <span className="text-xs font-semibold text-emerald-600">Live</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => handleAction("add")}
          disabled={actionLoading !== null}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {actionLoading === "add" ? "Adding…" : "+1 Walk-in"}
        </button>
        <button
          type="button"
          onClick={() => handleAction("remove")}
          disabled={actionLoading !== null || (occupancy ?? 0) === 0}
          className="px-4 py-2 rounded-lg border-2 border-stone-300 text-stone-700 font-medium hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {actionLoading === "remove" ? "Removing…" : "−1 Exit (FIFO)"}
        </button>
        <Link href="/admin/analytics" className="text-emerald-700 hover:underline text-sm font-medium">
          Analytics →
        </Link>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
