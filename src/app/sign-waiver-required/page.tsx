"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignWaiverRequiredPage() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waiverUrl, setWaiverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          You must sign the liability waiver,{" "}
          <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>, and{" "}
          <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link> before using the app or accessing the facility.
        </p>
        <p className="text-stone-600 text-sm mb-6">
          We&apos;ll send a waiver link to the email on your account. Click the link, review the documents, and check the box to agree.
        </p>
        <button
          type="button"
          onClick={handleSendLink}
          disabled={sending}
          className="w-full py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send waiver link to my email"}
        </button>
        {message && (
          <p className="mt-4 text-sm text-green-700">
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
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
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
