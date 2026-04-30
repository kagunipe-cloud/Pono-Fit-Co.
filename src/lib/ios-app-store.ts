/**
 * Public App Store product URL for the native iOS app
 *(e.g. https://apps.apple.com/app/... ).
 *
 * When unset or invalid, install UI falls back to Safari “Add to Home Screen” (PWA).
 */
export function getIosAppStoreUrl(): string | null {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_IOS_APP_STORE_URL : undefined;
  const u = typeof raw === "string" ? raw.trim() : "";
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
