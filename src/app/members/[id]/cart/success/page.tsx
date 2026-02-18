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

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
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
        setMessage(data.message ?? "Payment confirmed. Membership and bookings created.");
        // Redirect back to member page after 2 seconds
        setTimeout(() => router.push("/member"), 2000);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, [id, sessionId]);

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
        <p className="text-sm text-stone-600 mb-4">
          Door access has been updated if Kisi is configured.
        </p>
        <p className="text-sm text-stone-500 mb-4">Redirecting you back…</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link
            href="/member"
            className="inline-block px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            My home
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
