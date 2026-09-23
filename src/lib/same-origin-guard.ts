/**
 * Same-origin guard for state-changing UI route handlers (CSRF).
 *
 * The /api/idp proxy lifts the browser's HttpOnly access_token cookie into a
 * Bearer header, so any request the browser attaches cookies to acts with the
 * user's authority. SameSite=Lax stops cross-SITE pages, not a page on another
 * origin of the same site (another port, a sibling subdomain). This guard
 * closes that gap for every method other than GET/HEAD/OPTIONS:
 *
 *   - Origin present: it must equal the UI's configured public origin
 *     (runtime config `ui_origin`); when ui_origin is unset, the Origin's
 *     host must equal the request's Host header.
 *   - Origin absent: allowed only when Sec-Fetch-Site is `same-origin`.
 *   - Anything else: refused with 403 JSON before any upstream call, and one
 *     WARN line naming method, path and the reason — never cookies, tokens or
 *     query strings.
 */

import { NextResponse } from "next/server";
import type { RuntimeConfig } from "@/lib/types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type SameOriginVerdict = { ok: true } | { ok: false; reason: string };

interface GuardRequest {
  method: string;
  headers: Headers;
  nextUrl: { pathname: string };
}

function originOf(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function checkSameOrigin(
  req: GuardRequest,
  cfg: Pick<RuntimeConfig, "ui_origin"> | null
): SameOriginVerdict {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };

  const origin = req.headers.get("origin");
  if (origin === null) {
    return req.headers.get("sec-fetch-site") === "same-origin"
      ? { ok: true }
      : { ok: false, reason: "origin_missing" };
  }

  const requestOrigin = originOf(origin);
  if (requestOrigin === null) return { ok: false, reason: "origin_invalid" };

  const configured = cfg?.ui_origin ? originOf(cfg.ui_origin) : null;
  if (configured !== null) {
    return requestOrigin === configured ? { ok: true } : { ok: false, reason: "origin_mismatch" };
  }

  const host = req.headers.get("host");
  return host !== null && new URL(requestOrigin).host === host
    ? { ok: true }
    : { ok: false, reason: "origin_host_mismatch" };
}

/**
 * Returns a 403 response when the request fails the guard, or null when it
 * may proceed. The caller must return the response without calling upstream.
 */
export function refuseCrossOrigin(
  req: GuardRequest,
  cfg: Pick<RuntimeConfig, "ui_origin"> | null
): Response | null {
  const verdict = checkSameOrigin(req, cfg);
  if (verdict.ok) return null;
  console.warn(
    `[csrf] refused ${req.method.toUpperCase()} ${req.nextUrl.pathname} reason=${verdict.reason}`
  );
  return NextResponse.json({ error: "cross_origin_refused" }, { status: 403 });
}
