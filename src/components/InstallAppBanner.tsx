"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { getIosAppStoreUrl } from "@/lib/ios-app-store";
import { isNativeAppShell } from "@/lib/native-app-client";

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
  nativeInstallButtonLabel,
  fallbackInstallLinkLabel,
  /** Use on /install: show Android download CTAs even when the viewer is on iPhone (so the Android block doesn’t show the iOS link). */
  installCtaAs = "auto",
}: {
  variant?: "banner" | "inline";
  /** When true, show link to /install (iOS has no install API; Android may fall back if prompt never fires). */
  showInstallLink?: boolean;
  /** Chromium install prompt button (e.g. “Download for Android”). */
  nativeInstallButtonLabel?: string;
  /** Link to /install when native prompt is not available (default “Install help”). */
  fallbackInstallLinkLabel?: string;
  installCtaAs?: "auto" | "android" | "ios";
}) {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start true to avoid flash, then set false if we should show

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);

    if (isNativeAppShell()) {
      setDismissed(true);
      return;
    }

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

    const isMobile =
      isAndroid || isIOS || (typeof window !== "undefined" && window.innerWidth < 768);
    if (isMobile) {
      setDismissed(false);
    }
    /** Desktop: stay hidden until `beforeinstallprompt` (native install sheet). */

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setDismissed(false);
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

  const iosStoreUrl = getIosAppStoreUrl();
  const isBanner = variant === "banner";
  const ctaPlatform: Platform =
    installCtaAs === "android" ? "android" : installCtaAs === "ios" ? "ios" : platform;
  /** Chromium (Android + desktop): one-tap when beforeinstallprompt fired. */
  const showNativeInstallButton = installPrompt != null;
  const showIOSLink = ctaPlatform === "ios" && showInstallLink;
  const showIOSAppStoreLink = showIOSLink && iosStoreUrl != null;
  const showIOSInstallPageLink = showIOSLink && iosStoreUrl == null;
  const showGenericInstallLink =
    showInstallLink &&
    !showNativeInstallButton &&
    (ctaPlatform === "other" || ctaPlatform === "android");

  if (!showNativeInstallButton && !showIOSAppStoreLink && !showIOSInstallPageLink && !showGenericInstallLink) return null;

  const ctaClass =
    "block w-full py-2.5 px-4 rounded-lg font-medium text-center text-sm border border-brand-600 bg-brand-600 text-white hover:bg-brand-700";

  const content = (
    <>
      {showNativeInstallButton && (
        <button
          data-dumbbell-btn
          type="button"
          onClick={handleInstallClick}
          disabled={installing}
          className="w-full py-2.5 px-4 rounded-lg font-medium text-sm"
        >
          {installing ? "Opening…" : nativeInstallButtonLabel ?? "Add to Home Screen"}
        </button>
      )}
      {showIOSAppStoreLink && (
        <a
          href={iosStoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-dumbbell-btn
          className={ctaClass}
        >
          Download on the App Store
        </a>
      )}
      {(showIOSInstallPageLink || showGenericInstallLink) && (
        <Link href="/install" data-dumbbell-btn className={ctaClass}>
          {platform === "ios" ? "Add to Home Screen" : fallbackInstallLinkLabel ?? "Install help"}
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
              {(installCtaAs === "auto" ? platform : ctaPlatform) === "ios" && iosStoreUrl
                ? `Get ${BRAND.shortName} for iPhone`
                : `Get ${BRAND.shortName} on your home screen`}
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              {(installCtaAs === "auto" ? platform : ctaPlatform) === "ios"
                ? iosStoreUrl
                  ? "Get the official app from the App Store."
                  : "Tap below for quick steps to add this app."
                : installPrompt
                  ? "Use the button below — same as other apps’ “Add to Home screen” prompts."
                  : "Opens like an app from your home screen."}
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
