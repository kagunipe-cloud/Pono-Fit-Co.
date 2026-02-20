"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import InstallAppBanner from "@/components/InstallAppBanner";
import { BRAND } from "@/lib/branding";

type Platform = "android" | "ios" | "other";

function InstallContent() {
  const searchParams = useSearchParams();
  const memberId = searchParams.get("member_id") ?? "";
  const email = searchParams.get("email") ?? "";
  const hasSetPasswordParams = Boolean(memberId && email);

  const [platform, setPlatform] = useState<Platform>("other");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) setPlatform("android");
    else if (/iphone|ipad|ipod/.test(ua)) setPlatform("ios");
    else setPlatform("other");
  }, []);

  const installUrl = typeof window !== "undefined" ? `${window.location.origin}/install` : "/install";

  async function copyInstallLink() {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = installUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Add {BRAND.name} to your phone</h1>
      <p className="text-stone-500 text-sm mb-6">
        Install the app on your home screen — opens like a normal app, no browser bar.
      </p>

      {/* Send to a friend */}
      <div className="mb-8 p-4 rounded-xl border border-brand-200 bg-brand-50">
        <p className="text-sm font-medium text-stone-700 mb-2">Send to a friend</p>
        <p className="text-xs text-stone-600 mb-3">
          Text them this link. When they open it on their phone, they’ll see simple install steps.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={installUrl}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-700"
          />
          <button
            type="button"
            onClick={copyInstallLink}
            className="shrink-0 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>

      <p className="text-sm font-medium text-stone-700 mb-3">On this device</p>

      {/* Android: one-tap install when prompt is available */}
      {platform === "android" && (
        <div className="mb-8">
          <InstallAppBanner variant="inline" showInstallLink={false} />
          <p className="text-xs text-stone-500 mt-2">
            No button? Use Chrome’s menu (⋮) → “Install app” or “Add to Home screen”.
          </p>
        </div>
      )}

      {/* iOS: step-by-step (Safari only) */}
      {platform === "ios" && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 mb-8">
          <p className="text-sm font-medium text-stone-700 mb-3">Add to Home Screen (use Safari)</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-stone-600">
            <li>Tap the <strong>Share</strong> button (square with arrow up) at the bottom.</li>
            <li>Scroll and tap <strong>“Add to Home Screen”</strong>.</li>
            <li>Tap <strong>Add</strong>. Done.</li>
          </ol>
          <p className="text-xs text-stone-500 mt-3">
            Icon appears on your home screen — tap to open like an app.
          </p>
        </div>
      )}

      {/* Desktop / other: generic */}
      {platform === "other" && (
        <div className="bg-stone-100 rounded-xl p-4 mb-8 text-sm text-stone-600">
          <p className="font-medium text-stone-700 mb-1">Open this page on your phone</p>
          <p>Copy the link above and text it to yourself (or your friend). Open it in the phone's browser — you'll get install steps for iPhone or Android.</p>
        </div>
      )}

      {/* After install: set password (when arrived from post-purchase email with member_id & email) */}
      {hasSetPasswordParams && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 mb-8">
          <p className="text-sm font-medium text-stone-700 mb-2">Next: set your password</p>
          <p className="text-xs text-stone-500 mb-3">
            Create a password once so you can sign in to the app with your email and password.
          </p>
          <Link
            href={`/set-password?member_id=${encodeURIComponent(memberId)}&email=${encodeURIComponent(email)}`}
            className="inline-block w-full py-2.5 px-4 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 text-center text-sm"
          >
            Set your password
          </Link>
        </div>
      )}

      <p className="text-center">
        <Link href="/login" className="text-brand-600 hover:underline font-medium text-sm">
          ← Back to login
        </Link>
      </p>
      <p className="text-center mt-2">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm">
          Back to home
        </Link>
      </p>
    </div>
  );
}

export default function InstallPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto py-12 px-4 text-stone-500">Loading…</div>}>
      <InstallContent />
    </Suspense>
  );
}
