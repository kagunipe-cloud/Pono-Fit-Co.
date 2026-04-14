import type { NextRequest } from "next/server";

/**
 * Marker appended to the WebView User-Agent in Capacitor (see capacitor.config.ts).
 * Used to treat the App Store / Play shell as member-only: no admin or trainer surfaces.
 */
export const NATIVE_APP_USER_AGENT_TOKEN = "PonoFitNativeApp/1";

export function isNativeAppStoreClient(request: NextRequest | { headers: Headers }): boolean {
  const ua = request.headers.get("user-agent") ?? "";
  return ua.includes(NATIVE_APP_USER_AGENT_TOKEN);
}
