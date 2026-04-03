"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function GiftRedeemInner() {
  const searchParams = useSearchParams();
  const token =
    searchParams.get("t")?.trim() ||
    searchParams.get("token")?.trim() ||
    "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | { plan_name: string; expiry_date: string; pass_pack?: false }
    | { plan_name: string; pass_pack: true; pass_credits_remaining?: number; message?: string }
    | null
  >(null);

  const loginNext = token ? `/gift/redeem?t=${encodeURIComponent(token)}` : "/gift/redeem";

  async function redeem() {
    if (!token) {
      setError("This link is missing a token. Use the link from your gift email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-passes/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not redeem this gift.");
        return;
      }
      if (data.ok && data.plan_name) {
        if (data.pass_pack) {
          setSuccess({
            plan_name: data.plan_name,
            pass_pack: true,
            pass_credits_remaining: data.pass_credits_remaining,
            message: typeof data.message === "string" ? data.message : undefined,
          });
        } else {
          setSuccess({ plan_name: data.plan_name, expiry_date: data.expiry_date ?? "" });
        }
      } else {
        setError("Unexpected response.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    if (success.pass_pack) {
      return (
        <div className="max-w-md mx-auto py-12 px-4">
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
            <h1 className="text-xl font-bold text-stone-800 mb-2">Gift redeemed</h1>
            <p className="text-stone-600 text-sm mb-3">
              <span className="font-medium text-stone-800">{success.plan_name}</span>
              {success.pass_credits_remaining != null ? (
                <> — {success.pass_credits_remaining} day{success.pass_credits_remaining !== 1 ? "s" : ""} to use when you choose.</>
              ) : (
                " is on your account."
              )}
            </p>
            {success.message && <p className="text-stone-600 text-sm mb-4">{success.message}</p>}
            <Link
              href="/member/membership"
              className="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              My Membership — activate a pass day
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <h1 className="text-xl font-bold text-stone-800 mb-2">You&apos;re all set</h1>
          <p className="text-stone-600 text-sm mb-4">
            <span className="font-medium text-stone-800">{success.plan_name}</span> is now active
            {success.expiry_date ? (
              <>
                {" "}
                through <span className="font-mono">{success.expiry_date}</span>.
              </>
            ) : (
              "."
            )}
          </p>
          <Link href="/member" className="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
            Go to member home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Redeem a gift pass</h1>
        <p className="text-stone-500 text-sm mb-6">
          Sign in with the <strong>same email address</strong> the gift was sent to, then tap Redeem.
        </p>
        {!token && (
          <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            Open this page from the link in your gift email (it includes a secure token).
          </p>
        )}
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => redeem()}
            disabled={loading || !token}
            className="w-full px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Redeeming…" : "Redeem gift"}
          </button>
          <Link
            href={`/login?next=${encodeURIComponent(loginNext)}`}
            className="text-center text-sm text-brand-700 hover:underline"
          >
            Sign in or create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function GiftRedeemPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto py-12 px-4 text-stone-500 text-sm">Loading…</div>}>
      <GiftRedeemInner />
    </Suspense>
  );
}
