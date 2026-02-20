"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminEmailMembersPage() {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; total: number; failed: number; errors?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/email-all-members")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { count?: number; smtp_configured?: boolean } | null) => {
        setRecipientCount(data?.count ?? 0);
        setSmtpConfigured(data?.smtp_configured ?? false);
      })
      .catch(() => {
        setRecipientCount(0);
        setSmtpConfigured(false);
      })
      .finally(() => setLoadingCount(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const sub = subject.trim();
    const body = text.trim();
    if (!sub || !body) {
      setError("Subject and message are required.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/email-all-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: sub, text: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      setResult({ sent: data.sent, total: data.total, failed: data.failed ?? 0, errors: data.errors });
      setSubject("");
      setText("");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/members" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Members</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Email all members</h1>
      <p className="text-stone-500 text-sm mb-6">
        Send one email to every member who has an address on file. Uses your configured SMTP.
      </p>

      {loadingCount ? (
        <p className="text-stone-500 text-sm">Loading…</p>
      ) : smtpConfigured === false ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-900">
          <p className="font-medium mb-2">Email is not configured</p>
          <p className="text-sm mb-3">
            Use one of these options (set env vars in Railway or your host, then redeploy):
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-amber-800 mb-1">Option 1: Gmail API (recommended if SMTP is blocked)</p>
              <p className="mb-1">Uses HTTPS so it works on Railway and other hosts that block SMTP. You need a Google Cloud project, Gmail API enabled, and OAuth credentials. Set:</p>
              <ul className="list-disc list-inside font-mono text-amber-800">
                <li>GMAIL_OAUTH_CLIENT_ID</li>
                <li>GMAIL_OAUTH_CLIENT_SECRET</li>
                <li>GMAIL_OAUTH_REFRESH_TOKEN</li>
                <li>GMAIL_FROM_EMAIL (your Gmail address)</li>
              </ul>
              <p className="mt-2 text-xs">Step-by-step: see <code className="bg-amber-100 px-1 rounded">docs/EMAIL_GMAIL_API_SETUP.md</code> in the repo.</p>
            </div>
            <div>
              <p className="font-medium text-amber-800 mb-1">Option 2: SMTP</p>
              <ul className="list-disc list-inside font-mono text-amber-800">
                <li>SMTP_HOST (e.g. smtp.gmail.com)</li>
                <li>SMTP_USER</li>
                <li>SMTP_PASS</li>
              </ul>
            </div>
          </div>
        </div>
      ) : recipientCount === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          No members have an email address. Add emails in the member directory first.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-stone-600">
            <strong>{recipientCount}</strong> member{recipientCount !== 1 ? "s" : ""} will receive this email.
          </p>
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Class schedule update"
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
              required
            />
          </div>
          <div>
            <label htmlFor="text" className="block text-sm font-medium text-stone-700 mb-1">Message</label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your message…"
              rows={8}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200 resize-y"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-sm text-stone-700">
              <p>Sent to <strong>{result.sent}</strong> of {result.total} member{result.total !== 1 ? "s" : ""}.</p>
              {result.failed > 0 && result.errors && result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-amber-700">{result.failed} failed</summary>
                  <ul className="mt-1 text-xs text-stone-600 list-disc list-inside">{result.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}</ul>
                  {result.errors.length > 10 && <p className="mt-1 text-xs text-stone-500">… and {result.errors.length - 10} more</p>}
                </details>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to all members"}
          </button>
        </form>
      )}
    </div>
  );
}
