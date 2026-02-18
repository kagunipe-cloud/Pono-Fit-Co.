"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const STORAGE_KEY = "pwa-install-banner-dismissed";

/** Android install prompt event (not in all TS libs). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "android" | "ios" | "other";

export default function InstallAppBanner({
  variant = "banner",
  showInstallLink = true,
}: {
  variant?: "banner" | "inline";
  /** When true, show "Install app" / "Add to Home Screen" link to /install (for iOS or when prompt not yet available). */
  showInstallLink?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start true to avoid flash, then set false if we should show

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);

    // Already running as installed PWA
    const standalone =
      (navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) {
      setDismissed(true);
      return;
    }

    // Prefer not to show again this session
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      /* ignore */
    }

    // Detect mobile
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(ua);
    const isIOS = /iphone|ipad|ipod/.test(ua);
    if (isAndroid) setPlatform("android");
    else if (isIOS) setPlatform("ios");
    else setPlatform("other");

    // Only show banner on mobile (optional: show on desktop too with showInstallLink)
    const isMobile = isAndroid || isIOS || (typeof window !== "undefined" && window.innerWidth < 768);
    if (!isMobile) {
      setDismissed(true);
      return;
    }

    setDismissed(false);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  async function handleInstallClick() {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") setInstallPrompt(null);
    } finally {
      setInstalling(false);
    }
  }

  function handleDismiss() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  if (!mounted || dismissed) return null;

  const isBanner = variant === "banner";
  const showAndroidButton = platform === "android" && installPrompt != null;
  const showIOSLink = platform === "ios" && showInstallLink;
  const showGenericInstallLink = (platform === "other" || (platform === "android" && !installPrompt)) && showInstallLink;

  if (!showAndroidButton && !showIOSLink && !showGenericInstallLink) return null;

  const content = (
    <>
      {showAndroidButton && (
        <button
          data-dumbbell-btn
          type="button"
          onClick={handleInstallClick}
          disabled={installing}
          className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
        >
          {installing ? "Opening…" : "Install app"}
        </button>
      )}
      {(showIOSLink || showGenericInstallLink) && (
        <Link
          href="/install"
          data-dumbbell-btn
          className="block w-full py-2.5 px-4 rounded-lg font-medium text-center text-sm"
        >
          {platform === "ios" ? "Add to Home Screen" : "Install app"}
        </Link>
      )}
    </>
  );

  if (isBanner) {
    return (
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800">
              Get {BRAND.shortName} on your home screen
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              {platform === "ios"
                ? "Tap below for quick steps to add this app."
                : "One tap to install and open like an app."}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {content}
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 p-1 rounded text-stone-400 hover:text-stone-600"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {content}
    </div>
  );
}
