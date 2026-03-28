"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatPrice, toTitleCase } from "@/lib/format";

type PlanRow = { id: number; plan_name: string; price?: string; length?: string; unit?: string };

function MemberMembershipsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");
  const planFilterId = planParam != null && planParam !== "" ? parseInt(planParam, 10) : NaN;
  const hasValidPlanFilter = Number.isFinite(planFilterId) && planFilterId > 0;

  const [memberId, setMemberId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);

  const visiblePlans = useMemo(() => {
    if (!hasValidPlanFilter) return plans;
    const match = plans.filter((p) => p.id === planFilterId);
    return match.length > 0 ? match : [];
  }, [plans, hasValidPlanFilter, planFilterId]);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/offerings/membership-plans").then((r) => r.json()),
    ])
      .then(([me, list]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setPlans(Array.isArray(list) ? list : []);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function addToCart(id: number) {
    if (!memberId) return;
    setAdding(id);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "membership_plan", product_id: id, quantity: 1 }),
      });
      if (res.ok) {
        router.push("/member/cart");
      }
    } finally {
      setAdding(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!memberId) return null;

  const showNotFound =
    hasValidPlanFilter && plans.length > 0 && visiblePlans.length === 0;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Memberships</h1>
      {hasValidPlanFilter && visiblePlans.length > 0 && (
        <p className="text-sm text-stone-500 mb-6">
          Showing the plan you selected.{" "}
          <Link href="/member/memberships" className="text-brand-600 hover:underline">
            See all membership options
          </Link>
        </p>
      )}
      {showNotFound && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-6">
          That membership link is no longer available.{" "}
          <Link href="/member/memberships" className="text-brand-600 hover:underline font-medium">
            View all plans
          </Link>
        </p>
      )}
      <ul className="space-y-4">
        {visiblePlans.map((p) => (
          <li key={p.id} className="p-4 rounded-xl border border-stone-200 bg-white flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-stone-800">{toTitleCase(p.plan_name)}</p>
              <p className="text-sm text-stone-500">
                {formatPrice(p.price)} · {p.length} {p.unit}
              </p>
            </div>
            <button
              type="button"
              onClick={() => addToCart(p.id)}
              disabled={adding !== null}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {adding === p.id ? "Adding…" : "Add to cart"}
            </button>
          </li>
        ))}
      </ul>
      {visiblePlans.length === 0 && !showNotFound && <p className="text-stone-500">No membership plans available.</p>}
      <p className="mt-6">
        <Link href="/member/cart" className="text-brand-600 hover:underline">
          View cart →
        </Link>
      </p>
    </div>
  );
}

export default function MemberMembershipsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <MemberMembershipsContent />
    </Suspense>
  );
}
