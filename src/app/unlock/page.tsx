"use client";

import { useState } from "react";
import Link from "next/link";

export default function UnlockPage() {
  const [memberId, setMemberId] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const mid = memberId.trim();
    const em = email.trim();
    if (!mid || !em) {
      setMessage({ type: "error", text: "Enter your member ID and email." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kisi/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: mid, email: em }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Door unlocked." });
      } else {
        setMessage({ type: "error", text: data.error ?? "Unlock failed. Check your member ID and that your email is on file." });
      }
    } catch {
      setMessage({ type: "error", text: "Something went wrong." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-12 px-4">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Unlock Door</h1>
        <p className="text-stone-500 text-sm mb-6">
          Enter your member ID and email to unlock the gym door.
        </p>
        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label htmlFor="member_id" className="block text-sm font-medium text-stone-700 mb-1">
              Member ID
            </label>
            <input
              id="member_id"
              type="text"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="e.g. M001"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="username"
            />
          </div>
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
            />
          </div>
          <button
            data-dumbbell-btn
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        {message && (
          <p className={`mt-4 text-sm ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
      <p className="mt-6 text-center">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}
