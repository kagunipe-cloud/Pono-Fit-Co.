"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const MIN_PASSWORD_LENGTH = 8;

export default function BootstrapPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    secret: "",
    email: "",
    password: "",
    first_name: "Admin",
    last_name: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: form.secret.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          first_name: form.first_name.trim() || "Admin",
          last_name: form.last_name.trim() || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Bootstrap failed.");
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
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-stone-800 mb-1">Create first admin</h1>
        <p className="text-stone-500 text-sm mb-6">
          Your database has no members yet. Use this once to create an admin account so you can sign in. You need the bootstrap secret from your server environment (e.g. Railway variables).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="secret" className="block text-sm font-medium text-stone-700 mb-1">
              Bootstrap secret
            </label>
            <input
              id="secret"
              type="password"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              placeholder="From BOOTSTRAP_SECRET in env"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="first_name" className="block text-sm font-medium text-stone-700 mb-1">
              First name
            </label>
            <input
              id="first_name"
              type="text"
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <div>
            <label htmlFor="last_name" className="block text-sm font-medium text-stone-700 mb-1">
              Last name
            </label>
            <input
              id="last_name"
              type="text"
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-medium bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create admin"}
          </button>
        </form>
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
