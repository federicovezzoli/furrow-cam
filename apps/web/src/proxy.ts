import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic check: only looks for the session cookie. Pages still validate
 * the session server-side. Without an account, `/` opens the guest's last
 * project, `/new` a new one (linked from the website), and `/projects` shows
 * the projects kept in the browser (PRD-0008 G1, ADR-0050); signed-in users
 * go from `/` and `/new` to their projects. Bits and machines need a session.
 */
export function proxy(request: NextRequest) {
  const signedIn = Boolean(getSessionCookie(request));
  const { pathname } = request.nextUrl;
  if (pathname === "/" || pathname === "/new") {
    return signedIn
      ? NextResponse.redirect(new URL("/projects", request.url))
      : NextResponse.next();
  }
  if (!signedIn) return NextResponse.redirect(new URL("/sign-in", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/new", "/tools/:path*", "/machines/:path*"],
};
