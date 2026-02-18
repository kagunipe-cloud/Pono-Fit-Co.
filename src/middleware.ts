import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PATHS = [
  "/",
  "/members",
  "/money-owed",
  "/live-dashboard",
  "/pt-bookings",
  "/class-bookings",
  "/subscriptions",
  "/shopping-cart",
  "/sales",
  "/pt-sessions",
  "/classes",
  "/membership-plans",
  "/master-schedule",
  "/exercises",
  "/macros",
  "/class-packs",
  "/pt-packs",
];

function isAdminPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (ADMIN_PATHS.some((p) => p !== "/" && pathname === p)) return true;
  if (pathname.startsWith("/members/")) return true;
  if (pathname.startsWith("/admin")) return true;
  return false;
}

function isMemberPath(pathname: string): boolean {
  return pathname === "/member" || pathname.startsWith("/member/");
}

function isPublicPath(pathname: string): boolean {
  const publicPaths = ["/login", "/set-password", "/install", "/schedule", "/unlock"];
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
  const checkRes = await fetch(`${request.nextUrl.origin}/api/auth/check-session`, {
    headers: { cookie },
  });
  const data = (await checkRes.json().catch(() => ({}))) as { ok?: boolean; role?: string };
  const ok = data.ok === true;
  const role = data.role ?? "Member";

  if (isMemberPath(pathname)) {
    if (!ok) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  if (isAdminPath(pathname)) {
    if (!ok) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    if (role !== "Admin") {
      return NextResponse.redirect(new URL("/member", request.url));
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
