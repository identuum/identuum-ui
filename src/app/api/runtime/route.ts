/**
 * GET /api/runtime
 *
 * UI-owned composition endpoint. Discovers configured IDP and AG backends
 * by calling their /api/v1/component endpoints server-side, computes the
 * current platform mode, and returns a composed RuntimeState.
 *
 * This endpoint is NOT a proxy. It reads backend capability contracts and
 * computes a UI-owned view. Backends remain source of truth for all domain
 * data. Internal backend URLs are used for server-side calls and are never
 * returned in the response.
 *
 * Security: no authentication required (returns only non-sensitive metadata).
 * No secrets, tokens, keys, or internal URLs appear in the response.
 */
import { discoverRuntime } from "@/lib/runtime-composition";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { RuntimeState } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  const idpUrl = cfg?.idp.enabled ? idpBaseUrl(cfg) : null;
  const agUrl = cfg?.ag.enabled ? agBaseUrl(cfg) : null;

  const state: RuntimeState = await discoverRuntime(idpUrl, agUrl);
  return NextResponse.json(state, { status: 200 });
}
