"use client";

import { useEffect, useState, Suspense } from "react";

function SignWaiverContent() {
  const [token, setToken] = useState("");
  const [memberName, setMemberName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const t = params.get("token")?.trim() ?? "";
    setToken(t);
    if (!t) {
      setLoading(false);
      setError("Missing link. Use the link from your waiver email.");
      return;
    }
    fetch(`/api/waiver/validate?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setMemberName(data.first_name || data.member_id || "Member");
      })
      .catch(() => setError("Could not validate link."))
      .finally(() => setLoading(false));
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeChecked || !token || submitting) return;
    setSubmitting(true);
    setError(null);
    fetch("/api/waiver/agree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setSuccess(data.message ?? "Waiver signed. Door access has been activated.");
      })
      .catch(() => setError("Something went wrong. Please try again."))
      .finally(() => setSubmitting(false));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-stone-50">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-stone-50">
        <p className="text-red-600 text-center">{error}</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-stone-50">
        <div className="max-w-md w-full rounded-xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-green-700 font-medium">{success}</p>
          <p className="text-stone-500 text-sm mt-2">You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-stone-50">
      <div className="max-w-lg w-full rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Liability Waiver</h1>
        <p className="text-stone-600 text-sm mb-4">
          Hi{memberName ? ` ${memberName}` : ""}, please read the waiver and confirm below.
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
              I have read the waiver and agree to its terms.
            </span>
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={!agreeChecked || submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-brand-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-700"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SignWaiverPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-4 bg-stone-50"><p className="text-stone-500">Loading…</p></div>}>
      <SignWaiverContent />
    </Suspense>
  );
}
