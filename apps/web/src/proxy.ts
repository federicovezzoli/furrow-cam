import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic check: only looks for the session cookie. Pages still validate
 * the session server-side. `/` is the guest workspace (PRD-0008 G1), so
 * signed-in users go to their projects instead; the rest needs a session.
 */
export function proxy(request: NextRequest) {
  const signedIn = Boolean(getSessionCookie(request));
  if (request.nextUrl.pathname === "/") {
    return signedIn
      ? NextResponse.redirect(new URL("/projects", request.url))
      : NextResponse.next();
  }
  if (!signedIn) return NextResponse.redirect(new URL("/sign-in", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/projects/:path*", "/tools/:path*", "/machines/:path*"],
};
