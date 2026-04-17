/** Keep in sync with `appendUserAgent` in capacitor.config.ts and `native-app-request.ts`. */
const NATIVE_APP_UA_MARKER = "PonoFitNativeApp/1";

/** True in the Capacitor iOS/Android shell (WebView sends this User-Agent token). */
export function isNativeAppShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes(NATIVE_APP_UA_MARKER);
}
