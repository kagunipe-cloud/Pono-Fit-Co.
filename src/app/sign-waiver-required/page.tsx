"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function SignWaiverRequiredPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmailOption, setShowEmailOption] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waiverUrl, setWaiverUrl] = useState<string | null>(null);

  async function handleSignNow(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/waiver/agree-session", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.refresh();
        router.push(redirectTo && redirectTo.startsWith("/") ? redirectTo : "/member");
      } else {
        setError(data.error ?? "Failed to sign waiver.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendLink() {
    setSending(true);
    setMessage(null);
    setWaiverUrl(null);
    setError(null);
    try {
      const res = await fetch("/api/waiver/request-for-me", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message ?? "Waiver link sent to your email.");
        if (data.waiver_url) setWaiverUrl(data.waiver_url);
      } else {
        setError(data.error ?? "Failed to send waiver link.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-2">Waiver Required</h1>
        <p className="text-stone-600 text-sm mb-4">
          Sign the liability waiver to activate door access.
        </p>
        <p className="text-stone-600 text-sm mb-4">
          <a
            href="/waiver.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:underline font-medium"
          >
            Open the waiver (PDF)
          </a>
          {" · "}
          <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>
          {" · "}
          <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>
        </p>
        <form onSubmit={handleSignNow} className="space-y-4 mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeChecked}
              onChange={(e) => setAgreeChecked(e.target.checked)}
              className="mt-1 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-stone-700 text-sm">
              I have read the waiver, Privacy Policy, and Terms of Service, and agree to them.
            </span>
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={!agreeChecked || submitting}
            className="w-full py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Signing…" : "Sign waiver"}
          </button>
        </form>
        {!showEmailOption ? (
          <button
            type="button"
            onClick={() => setShowEmailOption(true)}
            className="text-sm text-stone-500 hover:text-stone-700"
          >
            Need to sign on another device? Send link to email
          </button>
        ) : (
          <div className="pt-4 border-t border-stone-100">
            <p className="text-stone-600 text-sm mb-2">We&apos;ll send a waiver link to the email on your account.</p>
            <button
              type="button"
              onClick={handleSendLink}
              disabled={sending}
              className="w-full py-2 rounded-lg border border-stone-200 text-stone-700 font-medium hover:bg-stone-50 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send waiver link to my email"}
            </button>
            {message && (
              <p className="mt-3 text-sm text-green-700">
                {message}
                {waiverUrl && (
                  <>
                    {" "}
                    <a href={waiverUrl} className="text-brand-600 hover:underline font-medium">
                      Open waiver link
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mt-6 text-center">
        <Link href="/login" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to login
        </Link>
      </p>
    </div>
  );
}
