"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InstallAppBanner from "@/components/InstallAppBanner";

const MIN_PASSWORD_LENGTH = 8;

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [memberId, setMemberId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mid = searchParams.get("member_id") ?? "";
    const em = searchParams.get("email") ?? "";
    if (mid) setMemberId(mid);
    if (em) setEmail(em);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const mid = memberId.trim();
    const em = email.trim().toLowerCase();
    if (!mid || !em) {
      setError("Member ID and email are required.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/member-set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: mid, email: em, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to set password.");
        return;
      }
      router.push("/login?password_set=1");
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-12 px-4">
      <InstallAppBanner variant="banner" />
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Set Your Password</h1>
        <p className="text-stone-500 text-sm mb-6">
          Create a password once. After this, you’ll sign in with your email and this password.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-700 mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-stone-700 mb-1">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Same password again"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
          <button
            data-dumbbell-btn
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Setting password…" : "Set password"}
          </button>
        </form>
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

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-sm mx-auto py-12 px-4 text-stone-500 text-center">Loading…</div>}>
      <SetPasswordContent />
    </Suspense>
  );
}
