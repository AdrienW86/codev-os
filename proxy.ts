import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/admin-policy";

export default clerkMiddleware(async (auth, request) => {
  const path = request.nextUrl.pathname;
  if (["/sw.js", "/offline.html", "/manifest.webmanifest", "/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/apple-touch-icon.png"].includes(path) && ["GET", "HEAD"].includes(request.method)) return;
  if (path === "/sign-up" || path.startsWith("/sign-up/")) {
    return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  }
  if (path === "/sign-in" || path.startsWith("/sign-in/") || path === "/__clerk" || path.startsWith("/__clerk/")) return;
  // Seule exemption : le déclencheur planifié s'authentifie lui-même par CRON_SECRET (voir la route).
  if (path === "/api/internal/scheduler/tick") return;

  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) {
    if (request.method !== "GET" && request.method !== "HEAD" || path.startsWith("/api/") || path.startsWith("/trpc/")) {
      return new NextResponse("Authentification requise", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("redirect_url", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }
  if (!isAuthorizedAdmin(userId)) {
    return new NextResponse("Accès refusé", { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico$).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
