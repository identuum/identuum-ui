/**
 * GET /api/ag-auth/login?idp=<slug>
 *
 * Proxy-redirects the browser to the AG identity surface OIDC login flow
 * for the specified IdP. Uses the public AG identity surface URL so the
 * internal backend URL is never exposed in the browser or rendered HTML.
 *
 * Security:
 *   - The `idp` query parameter is validated against a strict slug pattern
 *     before being used in the redirect URL (no injection possible).
 *   - Only relative query parameters are appended; no arbitrary URL is constructed.
 *   - Internal AG backend URLs are never returned or exposed to browsers.
 *   - The redirect destination uses ag.identity_base_url (public URL only).
 */
import { agIdentityPublicUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Matches AG's slug validation: lowercase alphanumeric + hyphens, 1-64 chars. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function GET(req: NextRequest): Response {
  const cfg = loadRuntimeConfig();

  if (!cfg?.ag.enabled) {
    return NextResponse.json(
      { error: "AG is not configured in this deployment." },
      { status: 503 }
    );
  }

  const idp = req.nextUrl.searchParams.get("idp") ?? "";

  if (!idp || !SLUG_PATTERN.test(idp)) {
    return NextResponse.json({ error: "Missing or invalid idp parameter." }, { status: 400 });
  }

  const publicIdentityUrl = agIdentityPublicUrl(cfg).replace(/\/$/, "");
  const destination = `${publicIdentityUrl}/login?idp=${encodeURIComponent(idp)}`;

  return NextResponse.redirect(destination, { status: 302 });
}
