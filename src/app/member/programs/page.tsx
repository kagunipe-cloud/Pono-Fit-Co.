"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Assignment = {
  id: number;
  title: string;
  description: string | null;
  source: string;
  workout_count: number;
};

type ShopProgram = {
  id: number;
  title: string;
  description: string | null;
  price_cents: number | null;
  workout_count: number;
  creator_first: string | null;
  creator_last: string | null;
};

function ProgramsInner() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "shop" ? "shop" : "mine";
  const router = useRouter();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [shop, setShop] = useState<ShopProgram[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (view === "shop") {
      fetch("/api/member/programs/shop")
        .then((r) => (r.ok ? r.json() : { programs: [] }))
        .then((d) => setShop(Array.isArray(d.programs) ? d.programs : []))
        .finally(() => setLoading(false));
    } else {
      fetch("/api/member/programs")
        .then((r) => {
          if (r.status === 401) {
            router.replace("/login?next=/member/programs");
            return { assignments: [] };
          }
          return r.ok ? r.json() : { assignments: [] };
        })
        .then((d) => setAssignments(Array.isArray(d.assignments) ? d.assignments : []))
        .finally(() => setLoading(false));
    }
  }, [view, router]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">My Programs</h1>
      <div className="flex gap-2 mb-6">
        <Link
          href="/member/programs?view=mine"
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "mine" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          My Programs
        </Link>
        <Link
          href="/member/programs?view=shop"
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "shop" ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          Programs for Purchase
        </Link>
      </div>

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : view === "shop" ? (
        shop.length === 0 ? (
          <p className="text-stone-600 text-sm">No programs for sale yet. Check back soon.</p>
        ) : (
          <ul className="space-y-3">
            {shop.map((p) => (
              <li key={p.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="font-semibold text-stone-900">{p.title}</p>
                <p className="text-sm text-stone-600 mt-1">{p.description || "Structured training program"}</p>
                <p className="text-xs text-stone-500 mt-2">
                  {p.workout_count} workouts
                  {p.creator_first || p.creator_last
                    ? ` · ${[p.creator_first, p.creator_last].filter(Boolean).join(" ")}`
                    : ""}
                </p>
                <p className="mt-2 font-medium text-brand-700">
                  {p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : "Pricing TBD"}
                </p>
                <p className="text-xs text-stone-500 mt-2">Checkout coming soon — ask the front desk or your trainer.</p>
              </li>
            ))}
          </ul>
        )
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-sm text-stone-600">
          <p className="font-medium text-stone-800">No program yet</p>
          <p className="mt-2">
            Purchase a program from{" "}
            <Link href="/member/programs?view=shop" className="text-brand-700 font-medium hover:underline">
              Programs for Purchase
            </Link>
            , or sign up for{" "}
            <Link href="/member/pt-sessions" className="text-brand-700 font-medium hover:underline">
              personal training
            </Link>{" "}
            if you&apos;d like a coach to build one for you.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/member/programs/${a.id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-brand-300 hover:bg-brand-50/30"
              >
                <p className="font-semibold text-stone-900">{a.title}</p>
                <p className="text-xs text-stone-500 mt-1">
                  {a.workout_count} workouts · {a.source === "purchase" ? "Purchased" : "From your coach"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8">
        <Link href="/member" className="text-sm text-brand-600 hover:underline">
          ← Member home
        </Link>
      </p>
    </div>
  );
}

export default function MemberProgramsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Loading…</div>}>
      <ProgramsInner />
    </Suspense>
  );
}