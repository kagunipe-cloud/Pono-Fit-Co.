"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import InstallAppBanner from "@/components/InstallAppBanner";
import { BRAND } from "@/lib/branding";

function usePageUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(typeof window !== "undefined" ? window.location.href : "");
  }, []);
  return url;
}

/** True when iOS and the browser isn’t Safari (Firefox, Edge, Chrome, etc. on iPhone). */
function useIOSNotSafari() {
  const [notSafari, setNotSafari] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    if (!isIOS) return;
    setNotSafari(/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(ua));
  }, []);
  return notSafari;
}

type Device = "android" | "ios" | "other";

function InstallContent() {
  const searchParams = useSearchParams();
  const memberId = searchParams.get("member_id") ?? "";
  const email = searchParams.get("email") ?? "";
  const hasSetPasswordParams = Boolean(memberId && email);

  const [device, setDevice] = useState<Device>("other");
  const pageUrl = usePageUrl();
  const iosNotSafari = useIOSNotSafari();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) setDevice("android");
    else if (/iphone|ipad|ipod/.test(ua)) setDevice("ios");
    else setDevice("other");
  }, []);

  const [copiedFriend, setCopiedFriend] = useState(false);
  const [copiedSafari, setCopiedSafari] = useState(false);

  const installUrl = typeof window !== "undefined" ? `${window.location.origin}/install` : "/install";

  async function copyInstallLink() {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopiedFriend(true);
      setTimeout(() => setCopiedFriend(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = installUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopiedFriend(true);
      setTimeout(() => setCopiedFriend(false), 2000);
    }
  }

  async function copyPageUrlForSafari() {
    const u = pageUrl || installUrl;
    try {
      await navigator.clipboard.writeText(u);
      setCopiedSafari(true);
      setTimeout(() => setCopiedSafari(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="max-w-md mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Add {BRAND.name} to your phone</h1>
      <p className="text-stone-500 text-sm mb-8">
        {device === "other"
          ? "On a laptop or desktop, just use this site in your browser — bookmark it if you like. Add-to-home-screen is optional and meant for phones."
          : "Opens full-screen from your home screen — like a regular app."}
      </p>

      {/* Send to a friend */}
      <div className="mb-10 p-4 rounded-xl border border-brand-200 bg-brand-50">
        <p className="text-sm font-medium text-stone-700 mb-2">Send to a friend</p>
        <p className="text-xs text-stone-600 mb-3">Text them this link. They’ll open it on their phone and follow the steps.</p>
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
            {copiedFriend ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>

      {/* Laptop / desktop — no install walkthrough */}
      {device === "other" && (
        <section className="mb-10 rounded-2xl border-2 border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-stone-900 mb-2">On a computer</h2>
          <p className="text-sm text-stone-600 mb-4">
            You don’t need to “install” anything — Safari, Firefox, Edge, Chrome, all fine. Use the site normally.
          </p>
          <p className="text-sm text-stone-600 mb-4">
            Want the app icon on your <strong>phone</strong>? Copy the link above and open it on your iPhone or Android, then follow the steps there.
          </p>
          <button
            type="button"
            onClick={copyPageUrlForSafari}
            className="flex items-center justify-center w-full py-3 px-4 rounded-xl border-2 border-brand-200 bg-brand-50 text-brand-800 font-semibold text-sm hover:bg-brand-100"
          >
            {copiedSafari ? "Copied!" : "Copy link to use on your phone"}
          </button>
        </section>
      )}

      {/* iPhone only */}
      {device === "ios" && (
        <section className="mb-10 rounded-2xl border-2 border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-stone-900 mb-1">Instructions for iPhone</h2>
          <p className="text-xs text-stone-500 mb-6">
            Add-to-home uses <strong>Safari</strong>. Other iPhone browsers (Firefox, Edge, Chrome, …) have to open the page in Safari first — Apple’s rule, not ours.
          </p>

          <div className="space-y-8">
            <div>
              <p className="text-4xl font-black text-brand-600 leading-none mb-2">1</p>
              {!iosNotSafari ? (
                <>
                  <p className="text-sm font-semibold text-stone-800 mb-2">You’re in Safari</p>
                  <p className="text-sm text-stone-600 mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                    Good — keep going to step 2. (If the Share button isn’t at the bottom, scroll up slightly.)
                  </p>
                  <button
                    type="button"
                    onClick={copyPageUrlForSafari}
                    className="w-full py-2 text-sm text-brand-700 font-medium hover:underline"
                  >
                    {copiedSafari ? "Copied!" : "Copy link (optional)"}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-stone-800 mb-2">Switch to Safari</p>
                  <p className="text-sm text-amber-900 mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    You’re in another browser, not Safari — a link can’t jump you into Safari (Apple’s rule). Use the{" "}
                    <strong>⋯</strong> or <strong>Share</strong> menu → <strong>Open in Safari</strong>, or copy the link and paste it in Safari.
                  </p>
                  <button
                    type="button"
                    onClick={copyPageUrlForSafari}
                    className="flex items-center justify-center w-full py-3.5 px-4 rounded-xl bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700"
                  >
                    {copiedSafari ? "Copied — open Safari and paste" : "Copy link → paste in Safari"}
                  </button>
                </>
              )}
            </div>

            <div>
              <p className="text-4xl font-black text-brand-600 leading-none mb-2">2</p>
              <p className="text-sm font-semibold text-stone-800 mb-3">Tap the Share button</p>
              <img
                src="/install/ios-step-share.svg"
                alt=""
                className="w-full rounded-xl border border-stone-100 bg-stone-50"
                width={280}
                height={120}
              />
              <p className="text-xs text-stone-500 mt-2 text-center">Square with arrow — bottom of the screen</p>
            </div>

            <div>
              <p className="text-4xl font-black text-brand-600 leading-none mb-2">3</p>
              <p className="text-sm font-semibold text-stone-800 mb-3">Choose Add to Home Screen</p>
              <img
                src="/install/ios-step-add-home.svg"
                alt=""
                className="w-full rounded-xl border border-stone-100 bg-stone-50"
                width={280}
                height={140}
              />
              <p className="text-xs text-stone-500 mt-2 text-center">Then tap Add — done.</p>
            </div>
          </div>
        </section>
      )}

      {/* Android phone only — single download flow */}
      {device === "android" && (
        <section className="mb-10 rounded-2xl border-2 border-stone-200 bg-stone-50 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-stone-900 mb-1">Download for Android</h2>
          <p className="text-xs text-stone-600 mb-4">Adds the app to your home screen from your browser’s install prompt.</p>
          <InstallAppBanner
            variant="inline"
            showInstallLink={false}
            installCtaAs="android"
            nativeInstallButtonLabel="Download for Android"
          />
          <p className="text-xs text-stone-500 mt-3">
            No prompt? Use your browser’s menu (often <strong>⋮</strong> or <strong>≡</strong> near the top or bottom) → <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong> — exact wording depends on the browser.
          </p>
        </section>
      )}

      {hasSetPasswordParams && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 mb-8">
          <p className="text-sm font-medium text-stone-700 mb-2">Next: set your password</p>
          <p className="text-xs text-stone-500 mb-3">Create a password once so you can sign in with your email.</p>
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
