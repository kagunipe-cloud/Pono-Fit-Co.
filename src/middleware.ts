import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PATHS = [
  "/",
  "/members",
  "/money-owed",
  "/pt-bookings",
  "/class-bookings",
  "/open-credits",
  "/subscriptions",
  "/members-expiry",
  "/transactions",
  "/sales",
  "/pt-sessions",
  "/classes",
  "/membership-plans",
  "/master-schedule",
  "/exercises",
  "/macros",
  "/class-packs",
  "/pt-packs",
  "/discounts",
  "/admin/leads",
];

const TRAINER_PATHS = ["/trainer"];

function isAdminPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (ADMIN_PATHS.some((p) => p !== "/" && pathname === p)) return true;
  if (pathname.startsWith("/members/")) return true;
  if (pathname.startsWith("/admin")) return true;
  return false;
}

function isTrainerPath(pathname: string): boolean {
  if (TRAINER_PATHS.some((p) => pathname === p)) return true;
  if (pathname.startsWith("/trainer/")) return true;
  return false;
}

function isMemberPath(pathname: string): boolean {
  return pathname === "/member" || pathname.startsWith("/member/") || pathname === "/sign-waiver-required" || pathname === "/accept-privacy-terms";
}

/** Cart & Stripe success live under /members/[id]/cart — allow the signed-in member (or staff) without Admin role. */
function isOwnMemberCartPath(pathname: string, sessionMemberId: string | null): boolean {
  if (!sessionMemberId) return false;
  return pathname === `/members/${sessionMemberId}/cart` || pathname === `/members/${sessionMemberId}/cart/success`;
}

function isPublicPath(pathname: string): boolean {
  const publicPaths = ["/login", "/signup", "/set-password", "/bootstrap", "/install", "/schedule", "/unlock", "/privacy", "/terms", "/sign-waiver"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  if (pathname.startsWith("/rec-leagues")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next") || pathname.includes(".")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.headers.get("cookie") ?? "";
  // Call our own API over HTTP to avoid SSL mismatch behind Railway/proxy (HTTPS in, internal HTTP)
  const port = process.env.PORT || "3000";
  const internalOrigin = process.env.INTERNAL_ORIGIN || `http://127.0.0.1:${port}`;
  const checkRes = await fetch(`${internalOrigin}/api/auth/check-session`, {
    headers: { cookie },
  });
  const data = (await checkRes.json().catch(() => ({}))) as { ok?: boolean; role?: string; member_id?: string };
  const ok = data.ok === true;
  const role = data.role ?? "Member";
  const sessionMemberId = typeof data.member_id === "string" ? data.member_id : null;

  if (ok && isOwnMemberCartPath(pathname, sessionMemberId)) {
    return NextResponse.next();
  }

  if (isMemberPath(pathname)) {
    if (!ok) {
      const login = new URL("/login", request.url);
      const nextUrl = pathname + (request.nextUrl.search || "");
      login.searchParams.set("next", nextUrl);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  if (isTrainerPath(pathname)) {
    if (!ok) {
      const login = new URL("/login", request.url);
      const nextUrl = pathname + (request.nextUrl.search || "");
      login.searchParams.set("next", nextUrl);
      return NextResponse.redirect(login);
    }
    if (role !== "Trainer" && role !== "Admin") {
      return NextResponse.redirect(new URL("/member", request.url));
    }
    return NextResponse.next();
  }

  if (isAdminPath(pathname)) {
    if (!ok) {
      const login = new URL("/login", request.url);
      const nextUrl = pathname + (request.nextUrl.search || "");
      login.searchParams.set("next", nextUrl);
      return NextResponse.redirect(login);
    }
    if (role !== "Admin") {
      return NextResponse.redirect(role === "Trainer" ? new URL("/trainer", request.url) : new URL("/member", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|app-icon|Logo|.*\\.(?:svg|png|ico|webp)$).*)",
  ],
};
