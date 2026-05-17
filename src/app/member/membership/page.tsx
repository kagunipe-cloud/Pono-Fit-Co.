"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Sub = {
  subscription_id?: string;
  plan_name?: string;
  status?: string;
  start_date?: string;
  expiry_date?: string;
  plan_price?: string;
  plan_unit?: string | null;
  plan_category?: string | null;
  plan_description?: string | null;
};

function MemberMembershipContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<{
    subscriptions: Sub[];
    has_saved_card?: boolean;
    auto_renew?: boolean;
    today_ymd?: string;
    day_pass_credits?: number;
    pass_activation_day?: string | null;
    waiver_complete_for_door?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cardMessage, setCardMessage] = useState<string | null>(null);
  const [togglingAutoRenew, setTogglingAutoRenew] = useState(false);
  const [activatingPass, setActivatingPass] = useState(false);
  const [activateMessage, setActivateMessage] = useState<string | null>(null);

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
          setCardMessage("Payment method updated successfully.");
          window.history.replaceState({}, "", "/member/membership");
          fetch("/api/member/me").then((r) => r.ok && r.json()).then(setData).catch(() => {});
        })
        .catch(() => setCardMessage("Payment method was updated; if this was your first time, it may take a moment to reflect."));
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

  async function activatePassForToday() {
    setActivateMessage(null);
    setActivatingPass(true);
    try {
      const res = await fetch("/api/member/activate-pass-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActivateMessage(typeof json.error === "string" ? json.error : "Could not activate.");
        return;
      }
      setActivateMessage("Pass is active for today. You can unlock the door.");
      const refreshed = await fetch("/api/member/me").then((r) => (r.ok ? r.json() : null));
      if (refreshed) setData(refreshed);
    } finally {
      setActivatingPass(false);
    }
  }

  async function toggleAutoRenew() {
    if (!data?.has_saved_card) return;
    setTogglingAutoRenew(true);
    try {
      const res = await fetch("/api/member/auto-renew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !data.auto_renew }),
      });
      const json = await res.json();
      if (json.ok) setData((d) => (d ? { ...d, auto_renew: json.auto_renew } : d));
    } finally {
      setTogglingAutoRenew(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!data) return null;

  const subs = data.subscriptions ?? [];
  const todayYmd = (data.today_ymd ?? "").trim();
  const dayPassCredits = Number(data.day_pass_credits ?? 0);
  const passAct = String(data.pass_activation_day ?? "").trim();
  const waiverOk = data.waiver_complete_for_door !== false;
  const needsWaiverForDayPass = dayPassCredits > 0 && !waiverOk;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">My Membership</h1>
      <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50">
        <p className="text-sm font-medium text-stone-800 mb-1">Payment method</p>
        <p className="text-sm text-stone-500 mb-2">
          Used for membership renewals. Add or switch to a card or bank account (ACH). When you complete an update
          here, that method becomes your default in Stripe. Lower fees with ACH.
        </p>
        <button
          type="button"
          onClick={changeCard}
          disabled={updatingCard}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {updatingCard ? "Redirecting…" : "Update payment method"}
        </button>
        {cardMessage && <p className="text-sm text-stone-600 mt-2">{cardMessage}</p>}
        <details className="mt-4 p-4 rounded-xl border-2 border-stone-200 bg-stone-100 open:border-stone-300">
          <summary className="cursor-pointer text-base font-semibold text-stone-700 hover:text-stone-900 list-none [&::-webkit-details-marker]:hidden">Having trouble?</summary>
          <div className="mt-4 space-y-3 text-base text-stone-600">
            <p>If the payment page doesn&apos;t load, try a different browser, incognito mode, or disable ad blockers.</p>
            <div className="pt-2 border-t border-stone-200">
              <p className="font-medium text-stone-800 mb-2">Still stuck? Call or email us:</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {typeof process.env.NEXT_PUBLIC_CONTACT_PHONE === "string" && process.env.NEXT_PUBLIC_CONTACT_PHONE.trim() ? (
                  <a href={`tel:${process.env.NEXT_PUBLIC_CONTACT_PHONE.replace(/\D/g, "")}`} className="text-brand-600 hover:underline font-medium">{process.env.NEXT_PUBLIC_CONTACT_PHONE.trim()}</a>
                ) : null}
                {typeof process.env.NEXT_PUBLIC_CONTACT_EMAIL === "string" && process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim() ? (
                  <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim()}`} className="text-brand-600 hover:underline font-medium">{process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim()}</a>
                ) : null}
                {(!process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() && !process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()) && (
                  <span>Contact us at the front desk or see our website.</span>
                )}
              </div>
            </div>
          </div>
        </details>
      </div>
      {subs.some((s) => s.status === "Active") && (
        <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <p className="text-sm font-medium text-stone-800 mb-1">Opt-in for auto-renewal</p>
          <p className="text-sm text-stone-500 mb-2">
            When enabled, we&apos;ll automatically charge your saved card when your membership expires so you don&apos;t have to renew manually. Add a payment method above first, then check the box below.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!data.auto_renew}
              onChange={toggleAutoRenew}
              disabled={togglingAutoRenew || !data.has_saved_card}
              className="rounded border-stone-300 text-brand-600"
            />
            <span className="text-sm font-medium text-stone-700">
              {data.has_saved_card
                ? (data.auto_renew ? "Yes, auto-renew my membership when it expires" : "Yes, opt me in for auto-renewal")
                : "Add a payment method above to opt in"}
            </span>
          </label>
        </div>
      )}

      {(dayPassCredits > 0 || (todayYmd && passAct === todayYmd)) && (
        <div className="mb-6 p-4 rounded-xl border border-brand-200 bg-brand-50/50">
          <h2 className="text-sm font-semibold text-stone-800 mb-1">Day pass credits</h2>
          {needsWaiverForDayPass && (
            <div className="mb-3 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-950">
              <p className="text-sm font-medium mb-1">Sign the liability waiver first</p>
              <p className="text-sm text-amber-900/90 mb-3">
                You have banked day passes, but the waiver must be on file before you can activate a day and use
                the door. This is separate from checkout.
              </p>
              <Link
                href="/sign-waiver-required?redirect=/member/membership"
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-800 text-white text-sm font-medium hover:bg-amber-900"
              >
                Sign waiver now
              </Link>
            </div>
          )}
          <p className="text-sm text-stone-600 mb-2">
            {dayPassCredits > 0
              ? `${dayPassCredits} day${dayPassCredits !== 1 ? "s" : ""} banked — activate when you plan to visit.`
              : "No banked days left."}
          </p>
          <p className="text-xs text-stone-500 mb-2">
            {needsWaiverForDayPass
              ? "Activate will stay disabled until the waiver is signed."
              : "On a visit day: activate below, then use Unlock Door on the home screen."}
          </p>
          {todayYmd && passAct === todayYmd && (
            <p className="text-sm font-medium text-green-800 mb-2">Pass active for today — you can unlock the door.</p>
          )}
          {activateMessage && <p className="text-sm text-stone-700 mb-2">{activateMessage}</p>}
          <button
            type="button"
            disabled={activatingPass || dayPassCredits <= 0 || (!!todayYmd && passAct === todayYmd) || needsWaiverForDayPass}
            onClick={() => void activatePassForToday()}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {activatingPass ? "Activating…" : "Activate pass for today"}
          </button>
        </div>
      )}

      {activateMessage && dayPassCredits <= 0 && !(todayYmd && passAct === todayYmd) && (
        <p className="mb-4 text-sm text-stone-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">{activateMessage}</p>
      )}

      {subs.length === 0 ? (
        <p className="text-stone-500">You don’t have a recurring membership on file.{dayPassCredits > 0 ? "" : " Purchase a pass pack or membership when you're ready."}</p>
      ) : (
        <ul className="space-y-4">
          {subs.map((s, i) => (
            <li key={i} className="p-4 rounded-xl border border-stone-200 bg-white">
              <p className="font-medium text-stone-800">{s.plan_name ?? "Membership"}</p>
              <p className="text-sm text-stone-500">
                {s.status} — {s.start_date} to {s.expiry_date} {s.plan_price ? `· ${s.plan_price}` : ""}
              </p>
              {String(s.plan_description ?? "").trim() ? (
                <p className="text-sm text-stone-600 mt-2 whitespace-pre-wrap">{String(s.plan_description).trim()}</p>
              ) : null}
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
