import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route gate: the app lives behind sign-in, discovery stays open.
 *
 * "Launch App" on the marketing page points at /dashboard. A signed-out visitor
 * is sent here to /login?next=/dashboard and lands back where they were going
 * once they authenticate, so the button needs no auth check of its own.
 *
 * Runs before render rather than in the page, so a protected page is never
 * painted and then yanked away. Pages are prerendered as static shells, so a
 * client-side guard would flash their content first.
 *
 * WHAT THIS IS AND IS NOT
 *
 * This checks that a session cookie is *present*. It does not verify it — the
 * cookie is HttpOnly and signed with a secret only the backend holds, and this
 * worker has no way to validate it. That is deliberate and sufficient: this gate
 * decides which page to show, while the backend independently authenticates every
 * request that returns data (requireUser) and enforces email verification on
 * sensitive ones (gateSensitiveActionByEmail). Forging the cookie's presence gets
 * an attacker a page shell whose every API call then 401s. It is the same
 * presence-check-for-routing pattern pages/api/proxy already uses.
 *
 * Note a present cookie does NOT mean the email is verified: registration sets
 * the session immediately, before the code is entered. That is why /login is
 * public and is never redirected away from even when a session exists — bouncing
 * a cookie-holder to the app would strand a newly registered user before the
 * verify step and they would never see their API key.
 */

const SESSION_COOKIE = "monocle_session";

/** Where a signed-in visitor lands from "Launch App", and the default post-login target. */
export const DEFAULT_APP_ROUTE = "/dashboard";

/**
 * Routes anyone may see signed out.
 *
 * An allowlist rather than a blocklist: a page added later is private until
 * somebody decides otherwise, which is the safer direction to be wrong in.
 * Everything here is either marketing or an SEO-indexed discovery surface —
 * /marketplace and the public agent profiles carry description meta and no
 * noindex, so gating them would pull agents out of search results.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login") return true;

  // Marketplace listing and anything under it.
  if (pathname === "/marketplace" || pathname.startsWith("/marketplace/")) return true;

  // Public agent profile: /agent/<id>
  if (/^\/agent\/[^/]+$/.test(pathname)) return true;

  // Public agent profile: /agents/<slug> — one segment only, so /agents/register
  // and the /agents/<slug>/edit|verify management pages stay gated.
  if (/^\/agents\/[^/]+$/.test(pathname) && pathname !== "/agents/register") return true;

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Round-trip the original destination so a deep link survives sign-in. Only the
  // path and query are carried, never an absolute URL, so this cannot be used to
  // bounce someone to another origin after login.
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Skip Next internals and, critically, /api — the proxy under /api/proxy is how
   * login itself talks to the backend, so gating it would make signing in
   * impossible. It does its own session checks on sensitive paths.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
