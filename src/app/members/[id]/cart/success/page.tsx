"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function CartSuccessPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;
  const sessionId = searchParams.get("session_id");
  const source = searchParams.get("source");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [dayPassPackPurchased, setDayPassPackPurchased] = useState(false);
  const [waiverCompleteForDoor, setWaiverCompleteForDoor] = useState<boolean | null>(null);

  useEffect(() => {
    if (source === "terminal" || source === "saved_card") {
      setStatus("success");
      setMessage("Payment confirmed. Membership and bookings created.");
      void fetch("/api/member/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((me: { day_pass_credits?: number; waiver_complete_for_door?: boolean } | null) => {
          if (!me) return;
          const credits = Number(me.day_pass_credits ?? 0);
          const w = me.waiver_complete_for_door;
          if (credits > 0) {
            setDayPassPackPurchased(true);
            if (w === false) {
              setWaiverCompleteForDoor(false);
              setMessage(
                "Payment confirmed. Your day passes are banked. Sign the liability waiver next, then open My Membership to activate a day when you visit."
              );
            } else {
              setWaiverCompleteForDoor(true);
              setMessage(
                "Payment confirmed. Your day passes are banked. On visit days, open My Membership → Activate pass for today, then use Unlock Door."
              );
            }
          }
        })
        .catch(() => {});
      const t = setTimeout(() => router.push("/member"), 4500);
      return () => clearTimeout(t);
    }
    if (!sessionId) {
      setStatus("error");
      setMessage("Missing session ID. Return to cart and try again.");
      return;
    }

    fetch("/api/cart/confirm-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: id, stripe_session_id: sessionId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to confirm payment");
        setStatus("success");
        setMessage(
          typeof data.message === "string"
            ? data.message
            : "Payment confirmed. Membership and bookings created."
        );
        setDayPassPackPurchased(data.day_pass_pack_purchased === true);
        if (typeof data.waiver_complete_for_door === "boolean") {
          setWaiverCompleteForDoor(data.waiver_complete_for_door);
        }
        // Redirect so they can open My Membership / sign waiver
        setTimeout(() => router.push("/member"), 4500);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, [id, sessionId, source, router]);

  if (status === "loading") {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-stone-600">Confirming your payment…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="max-w-md mx-auto py-12">
        <div className="p-6 rounded-xl border border-red-200 bg-red-50 text-red-800">
          <h2 className="font-semibold text-lg mb-2">Payment Confirmation Failed</h2>
          <p className="text-sm mb-4">{message}</p>
          <Link href={`/members/${id}/cart`} className="text-red-700 underline font-medium">
            ← Back to cart
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 text-center">
      <div className="p-6 rounded-xl border border-green-200 bg-green-50 text-green-800">
        <h2 className="font-semibold text-lg mb-2">Payment Successful</h2>
        <p className="text-sm mb-4">{message}</p>
        {dayPassPackPurchased && waiverCompleteForDoor === false && (
          <div className="mb-4 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-left">
            <p className="text-sm font-medium mb-2">Next step: liability waiver</p>
            <p className="text-sm text-amber-900/90 mb-3">
              Sign the waiver once, then go to <strong>My Membership</strong> to activate a day when you visit.
            </p>
            <Link
              href="/sign-waiver"
              className="inline-block px-4 py-2 rounded-lg bg-amber-800 text-white text-sm font-medium hover:bg-amber-900"
            >
              Sign waiver
            </Link>
            <Link
              href="/member/membership"
              className="inline-block ml-2 px-4 py-2 rounded-lg border border-amber-800 text-amber-900 text-sm font-medium hover:bg-amber-100/80"
            >
              My Membership
            </Link>
          </div>
        )}
        {!dayPassPackPurchased && (
          <p className="text-sm text-stone-600 mb-4">
            Door access has been updated if Kisi is configured.
          </p>
        )}
        <p className="text-sm text-stone-500 mb-4">Redirecting you to member home…</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link
            href="/member"
            className="inline-block px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            My home
          </Link>
          <Link
            href="/member/membership"
            className="inline-block px-4 py-2 rounded-lg border border-stone-300 text-stone-800 font-medium hover:bg-stone-50"
          >
            My Membership
          </Link>
          <Link
            href={`/members/${id}`}
            className="inline-block px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
          >
            Member profile
          </Link>
        </div>
      </div>
    </div>
  );
}
