/**
 * UI-side logout handler.
 *
 * Accepts a POST, forwards the session cookie to the IdP logout endpoint
 * (server-side, using internal_base_url when configured), then returns a
 * 303 redirect to /login that EXPIRES the browser's own auth cookies.
 *
 * THE-STALE-COOKIE: the IdP's Set-Cookie expirations land on the
 * SERVER-SIDE fetch response and never reach the browser — this route's
 * previous comment claimed the browser cookies were cleared, and nothing
 * cleared them. The revoked access_token then survived logout, the
 * /api/idp proxy lifted it into Authorization: Bearer on every subsequent
 * request, and the backend's global BearerPrincipal 401'd even PUBLIC
 * endpoints (organization-lookup) before their handlers ran — making
 * sign-in impossible after sign-out (measured by hand on v0.3.3). The
 * browser's cookies are OURS to clear, in OUR response: every cookie the
 * login flow sets (access_token + refresh_token — the exact pair the
 * IdP's setAuthCookies writes, Path=/, HttpOnly, SameSite=Lax) is expired
 * explicitly below, with matching attributes so the deletion applies.
 *
 * Using a UI route instead of a direct form POST to /api/idp/api/v1/logout
 * allows the browser to receive a proper 303 redirect to /login rather than
 * displaying the IdP's JSON response body.
 *
 * Tokens remain cookie-only. This route forwards cookies server-side and
 * never exposes them to JavaScript.
 */

import { type NextRequest, NextResponse } from "next/server";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

/** Every auth cookie the login flow sets — kept in ONE place so a new
 * cookie added to the login path gets added here or the relogin e2e
 * (e2e/login.spec.ts relogin cycle) fails on the survivor. */
const AUTH_COOKIES = ["access_token", "refresh_token"] as const;

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (cfg?.idp.enabled) {
    // Forward session cookies to the IdP logout endpoint server-side so
    // the backend revokes the session/tokens. Best-effort: the browser
    // cookie clearing below happens regardless of this hop's outcome.
    const cookieHeader = req.cookies
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    try {
      await fetch(`${idpBaseUrl(cfg)}/api/v1/logout`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
        cache: "no-store",
      });
    } catch {
      // Network failure during logout must not prevent the redirect or
      // the cookie clearing.
    }
  }

  // 303 See Other: POST → GET redirect with OUR OWN Set-Cookie
  // expirations attached — the only response the browser actually sees.
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303);
  for (const name of AUTH_COOKIES) {
    res.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }
  return res;
}
