/** Single-email API calls (forgot password, admin send reset, etc.) */
export const FETCH_TIMEOUT_EMAIL_MS = 120_000;

/** Welcome-email bulk POST can run many minutes (server maxDuration + stagger). */
export const FETCH_TIMEOUT_WELCOME_EMAIL_MS = 11 * 60 * 1000;

export function createFetchTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(tid),
  };
}

export function isFetchAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}
