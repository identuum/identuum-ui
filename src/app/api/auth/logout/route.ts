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
import { refuseCrossOrigin } from "@/lib/same-origin-guard";

export const dynamic = "force-dynamic";

/** Every auth cookie the login flow sets — kept in ONE place so a new
 * cookie added to the login path gets added here or the relogin e2e
 * (e2e/login.spec.ts relogin cycle) fails on the survivor. */
const AUTH_COOKIES = ["access_token", "refresh_token"] as const;

/**
 * THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02) — the logout decision, stated:
 * when the IdP cannot be reached or answers 5xx (its AUTH-503 class), the
 * server-side revocation is NOT confirmed, and this route STILL clears the
 * browser's cookies. That is deliberate and defensible — the user asked to
 * leave this device, and a browser that keeps a session it was told to drop
 * is the worse outcome — but it is never silent: the server log carries the
 * IdP's correlation id, and the redirect names the state
 * (/login?reason=signed_out_locally) so the /login copy and the operator can
 * tell "signed out everywhere" from "signed out here; the identity service
 * could not confirm". Only an unmarked 204 confirms completion; a refusal,
 * rate limit, redirect or unexpected success shape does not confirm revocation.
 */
export const LOGIN_SIGNED_OUT = "/login";
export const LOGIN_SIGNED_OUT_LOCALLY = "/login?reason=signed_out_locally";

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = loadRuntimeConfig();
  // CSRF: another origin must not be able to sign the user out (nor reach
  // the IdP with their cookie). Refused before anything is forwarded or cleared.
  const refused = refuseCrossOrigin(req, cfg);
  if (refused) return refused;

  // Only an unmarked 204 from the IdP confirms revocation (below).
  let destination = LOGIN_SIGNED_OUT_LOCALLY;

  if (cfg?.idp.enabled) {
    // Forward session cookies to the IdP logout endpoint server-side so
    // the backend revokes the session/tokens. The browser cookie clearing
    // below happens regardless of this hop's outcome — see the decision above.
    const cookieHeader = req.cookies
      .getAll()
      .filter((cookie) => AUTH_COOKIES.some((name) => name === cookie.name))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    try {
      const upstream = await fetch(`${idpBaseUrl(cfg)}/api/v1/logout`, {
        method: "POST",
        headers: { Cookie: cookieHeader, "X-Requested-With": "identuum-ui" },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (upstream.status !== 204 || upstream.headers.has("x-identuum-logout")) {
        const cid = upstream.headers.get("x-request-id") ?? "-";
        console.warn(
          `[logout] IdP answered ${upstream.status} (correlation_id=${cid}): server-side session revocation NOT confirmed; clearing this browser's cookies anyway (decision: THE-UNAVAILABLE-IS-NOT-EXPIRED)`
        );
        destination = LOGIN_SIGNED_OUT_LOCALLY;
      } else {
        destination = LOGIN_SIGNED_OUT;
      }
    } catch (err) {
      console.warn(
        `[logout] IdP unreachable (${err instanceof Error ? err.name : "error"}): server-side session revocation NOT confirmed; clearing this browser's cookies anyway (decision: THE-UNAVAILABLE-IS-NOT-EXPIRED)`
      );
      destination = LOGIN_SIGNED_OUT_LOCALLY;
    }
  }

  // 303 See Other: POST → GET redirect with OUR OWN Set-Cookie
  // expirations attached — the only response the browser actually sees.
  // The Location is RELATIVE: inside the container req.nextUrl.origin is the
  // listen address (http://0.0.0.0:7104), not the origin the browser is on,
  // so an absolute URL built from it sent every sign-out to a dead address.
  const res = new NextResponse(null, { status: 303, headers: { location: destination } });
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
