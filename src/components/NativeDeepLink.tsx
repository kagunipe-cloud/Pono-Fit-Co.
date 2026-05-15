"use client";

import { useEffect } from "react";

/**
 * When the native app opens from a Universal Link / App Link, forward the URL
 * into the Capacitor WebView so the member lands on the right path (same cookie jar).
 */
export default function NativeDeepLink() {
  useEffect(() => {
    let remove: (() => void) | undefined;

    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const { App } = await import("@capacitor/app");

        const go = (url: string) => {
          try {
            const u = new URL(url);
            const path = `${u.pathname}${u.search}${u.hash}`;
            const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (path !== current) {
              window.location.assign(path);
            }
          } catch {
            window.location.href = url;
          }
        };

        const launch = await App.getLaunchUrl();
        if (launch?.url) {
          go(launch.url);
        }

        const handle = await App.addListener("appUrlOpen", ({ url }) => {
          go(url);
        });
        remove = () => {
          void handle.remove();
        };
      } catch {
        // Web / SSR — Capacitor not present
      }
    })();

    return () => remove?.();
  }, []);

  return null;
}
