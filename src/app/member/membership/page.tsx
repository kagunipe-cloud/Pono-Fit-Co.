"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Sub = { plan_name?: string; status?: string; start_date?: string; expiry_date?: string; plan_price?: string };

function MemberMembershipContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<{ subscriptions: Sub[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cardMessage, setCardMessage] = useState<string | null>(null);

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

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const cardUpdated = searchParams.get("card_updated");
    if (sessionId && cardUpdated) {
      fetch("/api/member/setup-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      })
        .then(() => {
          setCardMessage("Card updated successfully.");
          window.history.replaceState({}, "", "/member/membership");
        })
        .catch(() => setCardMessage("Card was updated; if this was your first time, it may take a moment to reflect."));
    }
  }, [searchParams]);

  async function changeCard() {
    setUpdatingCard(true);
    setCardMessage(null);
    try {
      const res = await fetch("/api/member/update-payment-method", { method: "POST" });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else setCardMessage(json.error ?? "Could not start update");
    } finally {
      setUpdatingCard(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return null;

  const subs = data.subscriptions;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">My Membership</h1>
      <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50">
        <p className="text-sm font-medium text-stone-800 mb-1">Card on file</p>
        <p className="text-sm text-stone-500 mb-2">Used for membership renewals. If your card was declined or has expired, update it here so we can charge your next renewal.</p>
        <button
          type="button"
          onClick={changeCard}
          disabled={updatingCard}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {updatingCard ? "Redirecting…" : "Change card on file"}
        </button>
        {cardMessage && <p className="text-sm text-stone-600 mt-2">{cardMessage}</p>}
      </div>
      {subs.length === 0 ? (
        <p className="text-stone-500">You don’t have any memberships yet.</p>
      ) : (
        <ul className="space-y-4">
          {subs.map((s, i) => (
            <li key={i} className="p-4 rounded-xl border border-stone-200 bg-white">
              <p className="font-medium text-stone-800">{s.plan_name ?? "Membership"}</p>
              <p className="text-sm text-stone-500">
                {s.status} — {s.start_date} to {s.expiry_date} {s.plan_price ? `· ${s.plan_price}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6">
        <Link href="/member/memberships" className="text-brand-600 hover:underline">
          Purchase a membership →
        </Link>
      </p>
    </div>
  );
}

export default function MemberMembershipPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-stone-500">Loading…</div>}>
      <MemberMembershipContent />
    </Suspense>
  );
}
