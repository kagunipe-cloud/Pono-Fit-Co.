"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function AcceptPrivacyTermsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accept-privacy-terms", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.refresh();
        router.push(redirectTo && redirectTo.startsWith("/") ? redirectTo : "/member");
      } else {
        setError(data.error ?? "Failed to record acceptance.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-2">Privacy Policy & Terms of Service</h1>
        <p className="text-stone-600 text-sm mb-4">
          Please read and accept our Privacy Policy and Terms of Service to continue using the app.
        </p>
        <p className="text-stone-600 text-sm mb-4">
          <Link href="/privacy" className="text-brand-600 hover:underline font-medium">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" className="text-brand-600 hover:underline font-medium">
            Terms of Service
          </Link>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeChecked}
              onChange={(e) => setAgreeChecked(e.target.checked)}
              className="mt-1 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-stone-700 text-sm">
              I have read and agree to the Privacy Policy and Terms of Service.
            </span>
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={!agreeChecked || submitting}
            className="w-full py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Accepting…" : "Accept and continue"}
          </button>
        </form>
      </div>
      <p className="mt-6 text-center">
        <Link href="/login" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to login
        </Link>
      </p>
    </div>
  );
}
