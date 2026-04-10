"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InstallAppBanner from "@/components/InstallAppBanner";

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      setCheckError("Missing reset link. Use the link from your email or request a new one from Forgot password.");
      return;
    }
    fetch(`/api/auth/password-reset?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setValid(true);
        } else {
          setCheckError(data.error ?? "Invalid or expired link.");
        }
      })
      .catch(() => setCheckError("Could not validate link."))
      .finally(() => setChecking(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Reset failed.");
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
        <h1 className="text-xl font-bold text-stone-800 mb-1">Choose a new password</h1>
        {checking ? (
          <p className="text-stone-500 text-sm py-4">Checking your link…</p>
        ) : checkError ? (
          <p className="text-sm text-red-600 mt-2">{checkError}</p>
        ) : valid ? (
          <>
            <p className="text-stone-500 text-sm mb-6">Enter a new password for your account.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                {loading ? "Saving…" : "Update password"}
              </button>
            </form>
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          </>
        ) : null}
      </div>
      <p className="mt-6 text-center">
        <Link href="/login" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to login
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-sm mx-auto py-12 px-4 text-stone-500 text-center">Loading…</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
