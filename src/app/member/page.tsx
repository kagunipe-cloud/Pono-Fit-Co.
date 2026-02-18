"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toTitleCase } from "@/lib/format";

type MemberData = {
  member: { member_id: string; name: string; email: string | null };
  subscriptions: Record<string, unknown>[];
  classBookings: Record<string, unknown>[];
  ptBookings: Record<string, unknown>[];
  hasAccess: boolean;
} | null;

export default function MemberHomePage() {
  const router = useRouter();
  const [data, setData] = useState<MemberData>(null);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/member/me")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleUnlock() {
    if (!data?.member) return;
    setUnlockMessage(null);
    setUnlocking(true);
    try {
      const res = await fetch("/api/kisi/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: data.member.member_id }),
      });
      const json = await res.json();
      if (res.ok) {
        setUnlockMessage("Door unlocked.");
      } else {
        setUnlockMessage(json.error ?? "Unlock failed.");
      }
    } catch {
      setUnlockMessage("Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return null;

  const hasAccess = data.hasAccess;
  const activeSub = data.subscriptions.find((s) => s.status === "Active") as { plan_name?: string; expiry_date?: string } | undefined;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Welcome, {data.member.name}</h1>

      <div className="mb-8">
        <h2 className="text-sm font-medium text-stone-500 mb-2">Door Access</h2>
<button
            data-dumbbell-btn
            data-button-icon="app"
            type="button"
            onClick={handleUnlock}
          disabled={unlocking || !hasAccess}
          className={`w-full sm:w-auto px-6 py-3 rounded-lg font-medium ${
            hasAccess
              ? "font-medium disabled:opacity-50"
              : "bg-stone-200 text-stone-500 cursor-not-allowed"
          }`}
        >
          {unlocking ? "Unlocking…" : hasAccess ? "Unlock Door" : "No Active Membership"}
        </button>
        {!hasAccess && (
          <p className="text-sm text-stone-500 mt-2">Purchase a Membership to Unlock the Door.</p>
        )}
        {unlockMessage && (
          <p className="text-sm text-stone-600 mt-2">{unlockMessage}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/member/membership"
          className="block p-4 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors"
        >
          <h3 className="font-semibold text-brand-gray">My Membership</h3>
          <p className="text-sm text-brand-gray mt-1">
            {activeSub
              ? `${toTitleCase(activeSub.plan_name ?? "Active")} — Expires ${activeSub.expiry_date ?? ""}`
              : "No Active Membership"}
          </p>
        </Link>
        <Link
          href="/schedule"
          className="block p-4 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors"
        >
          <h3 className="font-semibold text-brand-gray">Schedule</h3>
          <p className="text-sm text-brand-gray mt-1">
            Book Classes & PT
          </p>
        </Link>
        <Link
          href="/member/class-bookings"
          className="block p-4 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors"
        >
          <h3 className="font-semibold text-brand-gray">My Class Bookings</h3>
          <p className="text-sm text-brand-gray mt-1">
            {(data.classBookings?.length ?? 0) + (data.occurrenceBookings?.length ?? 0)} booking{((data.classBookings?.length ?? 0) + (data.occurrenceBookings?.length ?? 0)) !== 1 ? "s" : ""}
          </p>
        </Link>
        <Link
          href="/member/pt-bookings"
          className="block p-4 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors"
        >
          <h3 className="font-semibold text-brand-gray">My PT Bookings</h3>
          <p className="text-sm text-brand-gray mt-1">
            {data.ptBookings.length} booking{data.ptBookings.length !== 1 ? "s" : ""}
          </p>
        </Link>
        <Link
          href="/member/workouts"
          className="block p-4 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors"
        >
          <h3 className="font-semibold text-brand-gray">Workouts</h3>
          <p className="text-sm text-brand-gray mt-1">
            Track Your Lifts and Cardio
          </p>
        </Link>
      </div>

      <div className="mt-8 pt-6 border-t border-stone-200">
        <h2 className="text-sm font-medium text-stone-500 mb-3">Purchase</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/member/classes"
            className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
          >
            Browse Classes
          </Link>
          <Link
            href="/member/class-packs"
            className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            Class Packs
          </Link>
          <Link
            href="/member/pt-sessions"
            className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            Browse PT Sessions
          </Link>
          <Link
            href="/member/pt-packs"
            className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            PT Packs
          </Link>
          <Link
            href="/member/memberships"
            className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            Memberships
          </Link>
          <Link
            href="/member/cart"
            className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            Cart
          </Link>
        </div>
      </div>
    </div>
  );
}
