"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InstallAppBanner from "@/components/InstallAppBanner";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("password_set") === "1") {
      setSuccess("Password set. You can sign in with your email and password.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim();
    if (!em || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/member-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "PASSWORD_NOT_SET" && data.member_id) {
          router.push(
            `/set-password?member_id=${encodeURIComponent(data.member_id)}&email=${encodeURIComponent(em)}`
          );
          return;
        }
        setError(data.error ?? "Login failed.");
        return;
      }
      const nextPath = searchParams.get("next")?.trim();
      const defaultDest = data.role === "Admin" ? "/" : "/member";
      const dest = nextPath && nextPath.startsWith("/") && !nextPath.includes("//") ? nextPath : defaultDest;
      router.push(dest);
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
        <h1 className="text-xl font-bold text-stone-800 mb-1">Sign in</h1>
        <p className="text-stone-500 text-sm mb-6">
          Members: access your membership, bookings, and door unlock. Staff: sign in with your admin account to open the admin dashboard.
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
            />
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
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="current-password"
            />
          </div>
          <button
            data-dumbbell-btn
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {success && (
          <p className="mt-4 text-sm text-green-600">{success}</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
      <p className="mt-6 text-center text-sm text-stone-500">
        First time?{" "}
        <Link href="/set-password" className="text-brand-600 hover:underline">
          Set your password
        </Link>
      </p>
      <p className="mt-2 text-center">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}
