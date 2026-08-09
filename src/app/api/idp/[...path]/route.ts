import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Headers that must not be forwarded to upstream.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

// Headers that browsers may send but must be stripped before forwarding to the IdP.
//
// IP-spoofing headers: The IdP trusts the UI container as a proxy
// (IDENTUUM_IDP_TRUSTED_PROXIES includes Docker subnets), so forwarding these from
// the browser would allow clients to spoof their IP and bypass rate limiting.
//
// Browser-context headers (origin, referer): The browser communicates with the UI
// (same-origin, no CORS needed). The UI proxy makes server-to-server requests to the
// IdP — forwarding Origin/Referer is incorrect because browser CORS semantics do not
// apply to server-to-server calls. Forwarding Origin caused the IdP's CORS middleware
// to reject proxied requests as cross-origin when the CORS origin list is misconfigured.
const STRIP_FROM_BROWSER = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "origin",
  "referer",
]);

// rewriteSetCookie strips Domain (scopes cookie to UI origin) and replaces
// SameSite=None with SameSite=Lax. None requires Secure and allows cross-site
// sending, which is inappropriate once the cookie is served from the UI origin.
// Lax is explicit rather than relying on browser defaults for an absent attribute.
function rewriteSetCookie(value: string): string {
  let replacedSameSiteNone = false;
  const parts = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const lower = part.toLowerCase();
      if (lower.startsWith("domain=")) return false;
      if (lower === "samesite=none") {
        replacedSameSiteNone = true;
        return false;
      }
      return true;
    });
  if (replacedSameSiteNone) parts.push("SameSite=Lax");
  return parts.join("; ");
}

async function proxyToIdP(req: NextRequest, segments: string[]): Promise<Response> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return NextResponse.json({ error: "IdP not configured" }, { status: 503 });
  }

  const base = idpBaseUrl(cfg).replace(/\/$/, "");
  const upstreamPath = `/${segments.join("/")}`;
  const search = req.nextUrl.search ?? "";
  const upstreamUrl = `${base}${upstreamPath}${search}`;

  // Build forwarded headers — exclude hop-by-hop and browser-spoofable proxy headers.
  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !STRIP_FROM_BROWSER.has(lower)) {
      forwardHeaders.set(key, value);
    }
  });

  // Released OSS resource endpoints establish the principal ONLY from
  // Authorization: Bearer (mw.BearerPrincipal never reads the access_token
  // cookie), so the proxy lifts the caller's OWN httpOnly access_token cookie
  // into a Bearer header on this server→IdP hop. No elevation: it is the same
  // credential the request already carries, the IdP validates it fully, and it
  // never reaches browser JS. A browser-supplied Authorization header, if any,
  // is left untouched.
  let liftedBearerFromCookie = false;
  if (!forwardHeaders.has("authorization")) {
    const accessToken = req.cookies.get("access_token")?.value;
    if (accessToken) {
      forwardHeaders.set("authorization", `Bearer ${accessToken}`);
      liftedBearerFromCookie = true;
    }
  }

  let body: BodyInit | null = null;
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: forwardHeaders,
      body: body ?? undefined,
      // Do not follow redirects — let the browser handle them.
      redirect: "manual",
    });
  } catch (err) {
    console.error("[idp-proxy] upstream fetch failed:", err);
    return NextResponse.json({ error: "IdP unreachable" }, { status: 502 });
  }

  // THE-STALE-COOKIE self-healing retry: a stale/revoked access_token
  // cookie must not break PUBLIC endpoints. The backend's GLOBAL
  // BearerPrincipal middleware verifies any presented bearer and, on
  // rejection, aborts with exactly 401 {"error":"unauthorized"} BEFORE
  // the route's handler runs — even on public routes like
  // organization-lookup. When (and only when) ALL THREE hold —
  //   (1) the Authorization header was OUR OWN cookie-lift (never a
  //       browser-supplied header),
  //   (2) upstream answered 401, and
  //   (3) the body is the middleware's distinctive pre-handler shape
  //       ({"error":"unauthorized"} — no handler emits that code;
  //       handler-level 401s use invalid_credentials /
  //       mfa_enrollment_required / etc., so no handler side effects
  //       can be double-executed by the retry)
  // — the request is retried ONCE without the lifted header, exactly as
  // an anonymous caller (this is what curl-without-cookies gets).
  //
  // WHY THIS CANNOT MASK a genuine authorization failure on a PROTECTED
  // route: the retry carries STRICTLY FEWER credentials, never more. A
  // protected route's guard (RequireAuthenticated / RequireSiteAdmin /
  // scope checks) rejects the credential-less retry with the same 401
  // the caller would have seen — the outcome is unchanged, only one
  // round trip is added. Masking would require the retry to SUCCEED
  // where a credentialed attempt legitimately failed, which is
  // impossible with a strict subset of credentials on a route that
  // requires one. Chosen over a path-aware attachment list because a
  // maintained public-path list drifts — every future public endpoint
  // would re-create this bug until listed; the retry is self-healing
  // for all present and future public paths.
  if (liftedBearerFromCookie && upstreamRes.status === 401) {
    const firstBodyText = await upstreamRes.text();
    let middlewareReject = false;
    try {
      middlewareReject =
        (JSON.parse(firstBodyText) as { error?: unknown }).error === "unauthorized";
    } catch {
      // Non-JSON 401 body — not the middleware shape; fall through.
    }
    if (middlewareReject) {
      forwardHeaders.delete("authorization");
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method,
          headers: forwardHeaders,
          body: body ?? undefined,
          redirect: "manual",
        });
      } catch (err) {
        console.error("[idp-proxy] anonymous retry failed:", err);
        return NextResponse.json({ error: "IdP unreachable" }, { status: 502 });
      }
    } else {
      // Rebuild the consumed first response verbatim.
      const rebuiltHeaders = new Headers();
      upstreamRes.headers.forEach((value, key) => {
        if (HOP_BY_HOP.has(key.toLowerCase())) return;
        if (key.toLowerCase() === "set-cookie") {
          rebuiltHeaders.append("set-cookie", rewriteSetCookie(value));
        } else {
          rebuiltHeaders.set(key, value);
        }
      });
      return new Response(firstBodyText, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: rebuiltHeaders,
      });
    }
  }

  // Build response headers, rewriting Set-Cookie domain.
  const resHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === "set-cookie") {
      resHeaders.append("set-cookie", rewriteSetCookie(value));
    } else {
      resHeaders.set(key, value);
    }
  });

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: resHeaders,
  });
}

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyToIdP(req, path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyToIdP(req, path);
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyToIdP(req, path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyToIdP(req, path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyToIdP(req, path);
}
