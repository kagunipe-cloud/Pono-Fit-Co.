"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Discount = {
  id: number;
  code: string;
  percent_off: number;
  description: string | null;
  scope: string;
  applies_to_renewals?: number;
};

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState<"persistent" | "grandfather" | null>(null);

  async function fetchDiscounts() {
    try {
      const res = await fetch("/api/admin/discounts");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDiscounts(data);
    } catch {
      setDiscounts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDiscounts();
  }, []);

  async function runBackfill(mode: "persistent_only" | "any_saved_code") {
    setBackfillBusy(mode === "persistent_only" ? "persistent" : "grandfather");
    setBackfillMsg(null);
    try {
      const res = await fetch("/api/admin/subscriptions/backfill-renewal-discount-from-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackfillMsg(typeof data.error === "string" ? data.error : "Backfill failed.");
        return;
      }
      setBackfillMsg(
        `Updated ${data.updated ?? 0} subscription(s) (${data.matched ?? 0} matched, mode: ${data.mode ?? mode}). Only rows with no renewal discount yet were changed.`
      );
    } catch {
      setBackfillMsg("Request failed.");
    } finally {
      setBackfillBusy(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this discount?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/discounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchDiscounts();
    } catch {
      alert("Could not delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to Settings</Link>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            Discounts
          </h1>
          <p className="text-stone-500 mt-1">
            Promo codes for cart checkout. Turn on <strong>Renewals</strong> so the same percent applies to each monthly renewal (stored on the subscription).
          </p>
        </div>
        <Link
          href="/discounts/new"
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add discount
        </Link>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : discounts.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No discounts yet.{" "}
            <Link href="/discounts/new" className="text-brand-600 hover:underline">Add your first discount</Link>
          </div>
        ) : (
          <table className="w-full text-left min-w-[500px]">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Percent off</th>
                <th className="py-3 px-4">Scope</th>
                <th className="py-3 px-4">Renewals</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-t border-stone-100 hover:bg-brand-50/30">
                  <td className="py-3 px-4 font-mono font-medium text-stone-800">{d.code}</td>
                  <td className="py-3 px-4 text-stone-600">{d.percent_off}%</td>
                  <td className="py-3 px-4 text-stone-600 capitalize">{d.scope ?? "cart"}</td>
                  <td className="py-3 px-4 text-stone-600">{(d.applies_to_renewals ?? 0) === 1 ? "Yes" : "One-time"}</td>
                  <td className="py-3 px-4 text-stone-600">{d.description ?? "—"}</td>
                  <td className="py-3 px-4 flex gap-2">
                    <Link href={`/discounts/${d.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="text-red-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {deletingId === d.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="mt-10 max-w-2xl border border-amber-200 bg-amber-50/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-stone-800">Existing members (backfill)</h2>
        <p className="text-sm text-stone-600 mt-2">
          If someone already checked out with a promo before renewals were enabled, mark the code as <strong>Renewals: Yes</strong> above, then run{" "}
          <strong>Backfill (renewal codes only)</strong>. That sets renewal pricing from the sale&apos;s promo for active monthly subscriptions that still
          have no renewal discount.
        </p>
        <p className="text-sm text-stone-600 mt-2">
          <strong>Grandfather (any known code)</strong> uses any promo on the sale that matches a discount row, even if the code is still &quot;one-time&quot;
          for new signups — use once if you need to catch historical checkouts before you toggled the flag.
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <button
            type="button"
            disabled={backfillBusy !== null}
            onClick={() => runBackfill("persistent_only")}
            className="px-4 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 disabled:opacity-50"
          >
            {backfillBusy === "persistent" ? "Running…" : "Backfill (renewal codes only)"}
          </button>
          <button
            type="button"
            disabled={backfillBusy !== null}
            onClick={() => {
              if (!confirm("Apply discount from sale for every active monthly sub with a matching code, including one-time codes?")) return;
              runBackfill("any_saved_code");
            }}
            className="px-4 py-2 rounded-lg border border-stone-300 bg-white text-stone-800 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            {backfillBusy === "grandfather" ? "Running…" : "Grandfather (any known code)"}
          </button>
        </div>
        {backfillMsg && <p className="text-sm text-stone-700 mt-3">{backfillMsg}</p>}
      </section>
    </div>
  );
}
