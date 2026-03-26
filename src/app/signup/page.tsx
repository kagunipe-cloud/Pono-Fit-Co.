"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InstallAppBanner from "@/components/InstallAppBanner";
import { EMAIL_POLICY_MESSAGE } from "@/lib/email-policy";

const MIN_PASSWORD_LENGTH = 8;

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim();
    if (!em || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/member-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: em,
          password,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Signup failed.");
        return;
      }
      if (!data.privacy_terms_accepted) {
        window.location.href = redirectTo ? `/accept-privacy-terms?redirect=${encodeURIComponent(redirectTo)}` : "/accept-privacy-terms";
        return;
      }
      if (data.needs_waiver) {
        window.location.href = redirectTo ? `/sign-waiver-required?redirect=${encodeURIComponent(redirectTo)}` : "/sign-waiver-required";
        return;
      }
      const dest = data.role === "Admin" ? "/" : (redirectTo && redirectTo.startsWith("/") ? redirectTo : "/member");
      window.location.href = dest;
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
        <h1 className="text-xl font-bold text-stone-800 mb-1">Create account</h1>
        <p className="text-stone-500 text-sm mb-3">
          Sign up to browse classes, book sessions, and manage your membership.
        </p>
        <p className="text-stone-800 text-base sm:text-lg font-bold leading-snug mb-6 p-4 rounded-lg bg-stone-50 border border-stone-200">
          {EMAIL_POLICY_MESSAGE}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="first_name" className="block text-sm font-medium text-stone-700 mb-1">
                First name
              </label>
              <input
                id="first_name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First"
                className="w-full px-3 py-2 rounded-lg border border-stone-200"
                autoComplete="given-name"
              />
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-medium text-stone-700 mb-1">
                Last name
              </label>
              <input
                id="last_name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last"
                className="w-full px-3 py-2 rounded-lg border border-stone-200"
                autoComplete="family-name"
              />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-700 mb-1">
              Password
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
              required
            />
          </div>
          <button
            data-dumbbell-btn
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
      <p className="mt-6 text-center text-sm text-stone-500">
        Already have an account?{" "}
        <Link href="/login" className="text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-center">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to home
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-stone-500">
        <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>
        {" · "}
        <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="max-w-sm mx-auto py-12 px-4 text-stone-500 text-center">Loading…</div>}>
      <SignupContent />
    </Suspense>
  );
}
