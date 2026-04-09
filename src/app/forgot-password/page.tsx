"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import InstallAppBanner from "@/components/InstallAppBanner";
import {
  createFetchTimeoutSignal,
  FETCH_TIMEOUT_EMAIL_MS,
  isFetchAbortError,
} from "@/lib/client-fetch-timeout";

function ForgotPasswordContent() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const em = email.trim().toLowerCase();
    if (!em) {
      setError("Enter your email.");
      return;
    }
    setLoading(true);
    const { signal, clear } = createFetchTimeoutSignal(FETCH_TIMEOUT_EMAIL_MS);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessage(data.message ?? "Check your email for the next step.");
      setEmail("");
    } catch (e) {
      if (isFetchAbortError(e)) {
        setError(
          "Request timed out — the server may be slow to send mail. Wait a minute, check your inbox, or try again."
        );
      } else {
        setError("Something went wrong.");
      }
    } finally {
      clear();
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-12 px-4">
      <InstallAppBanner variant="banner" />
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Forgot password</h1>
        <p className="text-stone-500 text-sm mb-6">
          Enter the email on your account. If we find it, we&apos;ll send a link to reset your password (24 hours).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="email"
              required
            />
          </div>
          <button
            data-dumbbell-btn
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
        {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
      <p className="mt-6 text-center">
        <Link href="/login" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to login
        </Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-sm mx-auto py-12 px-4 text-stone-500 text-center">Loading…</div>}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
