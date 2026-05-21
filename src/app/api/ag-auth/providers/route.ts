/**
 * GET /api/ag-auth/providers
 *
 * Returns AG human/operator login provider metadata for browser consumption.
 * Proxies and sanitises the AG /api/v1/auth/providers response.
 *
 * Security:
 *   - Internal AG management URL is never included in the response.
 *   - login_url values in the response are the raw relative paths from AG
 *     (e.g. "/login?idp=entra-prod"). Callers must NOT render these as
 *     browser links directly; use GET /api/ag-auth/login?idp=<id> instead.
 *   - Raw AG errors, stack traces, tokens, and secrets are never returned.
 *   - The endpoint is unauthenticated (returns only public login-flow metadata).
 */
import { fetchAgAuthProviders } from "@/lib/ag-auth-providers";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { AgAuthProviderDiscoveryState } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();
  const agUrl = cfg?.ag.enabled ? agBaseUrl(cfg) : null;

  const state: AgAuthProviderDiscoveryState = await fetchAgAuthProviders(agUrl);
  return NextResponse.json(state, { status: 200 });
}
