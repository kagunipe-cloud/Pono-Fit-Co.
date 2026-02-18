"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const DEFAULT_WAIVER_TEXT = `I understand that participation in rec league activities may involve physical activity and risk of injury. I voluntarily assume all risks. I release ${BRAND.name} and its staff from any liability for injury or loss. I confirm that the information I provide is accurate.`;

function RecLeaguesWaiverContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "valid" | "invalid" | "signed">("loading");
  const [teamName, setTeamName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [error, setError] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      setError("Missing waiver link.");
      return;
    }
    fetch(`/api/rec-leagues/waiver?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setStatus("valid");
          setTeamName(data.team_name ?? "");
          setMemberName(data.member_name ?? "");
        } else {
          setStatus("invalid");
          setError(data.error ?? "Invalid or expired link.");
        }
      })
      .catch(() => {
        setStatus("invalid");
        setError("Could not load waiver.");
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree || !token) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/rec-leagues/waiver/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("signed");
      } else {
        setError(data.error ?? "Failed to submit.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <h1 className="text-xl font-bold text-stone-800 mb-2">Waiver</h1>
        <p className="text-red-600">{error}</p>
        <p className="text-stone-500 text-sm mt-4">
          <Link href="/" className="text-brand-600 hover:underline">Back to {BRAND.name}</Link>
        </p>
      </div>
    );
  }

  if (status === "signed") {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <h1 className="text-xl font-bold text-stone-800 mb-2">Thank You</h1>
        <p className="text-stone-600">Your waiver has been signed and recorded. You’re all set.</p>
        <p className="text-stone-500 text-sm mt-4">
          <Link href="/" className="text-brand-600 hover:underline">Back to {BRAND.name}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <h1 className="text-xl font-bold text-stone-800 mb-2">Rec League Waiver</h1>
      <p className="text-stone-600 text-sm mb-4">
        <strong>{memberName}</strong> – {teamName}
      </p>
      <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 mb-6 text-sm text-stone-700 whitespace-pre-wrap">
        {DEFAULT_WAIVER_TEXT}
      </div>
      <form onSubmit={handleSubmit}>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        <label className="flex items-start gap-2 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1 rounded border-stone-300 text-brand-600"
          />
          <span className="text-sm text-stone-700">I have read and agree to the above waiver.</span>
        </label>
        <button
          data-dumbbell-btn
          type="submit"
          disabled={!agree || submitting}
          className="px-4 py-2.5 rounded-lg font-medium disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </div>
  );
}

export default function RecLeaguesWaiverPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto py-12 px-4 text-stone-500">Loading…</div>}>
      <RecLeaguesWaiverContent />
    </Suspense>
  );
}
