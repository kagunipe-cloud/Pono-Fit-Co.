import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "member_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set and at least 16 characters");
  }
  return s;
}

function sign(value: string): string {
  const secret = getSecret();
  const hmac = createHmac("sha256", secret);
  hmac.update(value);
  return `${value}.${hmac.digest("base64url")}`;
}

function verify(token: string): string | null {
  try {
    const secret = process.env.SESSION_SECRET?.trim();
    if (!secret || secret.length < 16) return null;
    const i = token.lastIndexOf(".");
    if (i === -1) return null;
    const value = token.slice(0, i);
    const sig = token.slice(i + 1);
    const expected = createHmac("sha256", secret!).update(value).digest("base64url");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function getMemberIdFromSession(): Promise<string | null> {
  return (async () => {
    try {
      const store = await cookies();
      const token = store.get(COOKIE_NAME)?.value;
      if (!token) return null;
      return verify(token);
    } catch {
      return null;
    }
  })();
}

export function setMemberSession(memberId: string): Promise<void> {
  return (async () => {
    const store = await cookies();
    store.set(COOKIE_NAME, sign(memberId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  })();
}

export function clearMemberSession(): Promise<void> {
  return (async () => {
    const store = await cookies();
    store.delete(COOKIE_NAME);
  })();
}
