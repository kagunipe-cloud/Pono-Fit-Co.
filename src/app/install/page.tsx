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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) setPlatform("android");
    else if (/iphone|ipad|ipod/.test(ua)) setPlatform("ios");
    else setPlatform("other");
  }, []);

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Install {BRAND.name}</h1>
      <p className="text-stone-500 text-sm mb-6">
        Add this app to your home screen to open it like a normal app — no browser bar, quick access.
      </p>

      {/* Android: one-tap install when prompt is available */}
      {platform === "android" && (
        <div className="mb-8">
          <InstallAppBanner variant="inline" showInstallLink={false} />
          <p className="text-xs text-stone-500 mt-2">
            If you don’t see the button above, use Chrome’s menu (⋮) → “Install app” or “Add to Home screen”.
          </p>
        </div>
      )}

      {/* iOS: step-by-step (Safari only) */}
      {platform === "ios" && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 mb-8">
          <p className="text-sm font-medium text-stone-700 mb-3">Add to Home Screen (Safari)</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-stone-600">
            <li>Open this page in <strong>Safari</strong> (not Chrome).</li>
            <li>Tap the <strong>Share</strong> button (square with arrow up) at the bottom.</li>
            <li>Scroll and tap <strong>“Add to Home Screen”</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
          <p className="text-xs text-stone-500 mt-3">
            The app icon will appear on your home screen. Tap it to open like an app.
          </p>
        </div>
      )}

      {/* Desktop / other: generic */}
      {platform === "other" && (
        <div className="bg-stone-100 rounded-xl p-4 mb-8 text-sm text-stone-600">
          <p>On your phone, open this page in a browser and you’ll see install options for Android or iPhone.</p>
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
