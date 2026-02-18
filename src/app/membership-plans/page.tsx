"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type Plan = {
  id: number;
  product_id: string;
  plan_name: string | null;
  price: string | null;
  length: string | null;
  unit: string | null;
  access_level: string | null;
  category: string | null;
  description: string | null;
};

export default function MembershipPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function fetchPlans() {
    try {
      const res = await fetch("/api/offerings/membership-plans");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setPlans(data);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this plan?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offerings/membership-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchPlans();
    } catch {
      alert("Could not delete. It may be in use.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
            Membership plans
          </h1>
          <p className="text-stone-500 mt-1">Plans with duration (length + unit). Add, edit, or delete.</p>
        </div>
        <Link
          href="/membership-plans/new"
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add plan
        </Link>
      </header>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No plans yet.{" "}
            <Link href="/membership-plans/new" className="text-brand-600 hover:underline">Add your first plan</Link>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Plan</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-stone-100 hover:bg-brand-50/30">
                  <td className="py-3 px-4 font-medium text-stone-800">{p.plan_name ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{formatPrice(p.price)}</td>
                  <td className="py-3 px-4 text-stone-600">{p.length ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{p.unit ?? "—"}</td>
                  <td className="py-3 px-4 text-stone-600">{p.category ?? "—"}</td>
                  <td className="py-3 px-4 flex gap-2">
                    <Link href={`/membership-plans/${p.id}/edit`} className="text-brand-600 hover:underline text-sm">Edit</Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      disabled={deletingId === p.id}
                      className="text-red-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {deletingId === p.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
