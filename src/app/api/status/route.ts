import { NextResponse } from "next/server";
import type { BackendDomain } from "@/lib/backend-product-labels";
import { deriveProductLabel } from "@/lib/backend-product-labels";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { StatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// healthPaths returns the liveness paths each backend may mount, probed in
// order. The IDP is CROSS-TIER: identuum-idp-ce uses the Kubernetes-convention
// `/healthz` (cmd/identuum-idp/serve.go), while released identuum-idp-oss
// mounts `/health` (+`/livez`) and 404s `/healthz` — so the probe tries the CE
// path first and falls back to the OSS path. identuum-ag still publishes
// `/health` today. Pinned by src/__tests__/api-status-health-paths.test.ts so
// a future refactor cannot silently drop either tier's path and surface a
// false "identuum-idp unreachable" on the logged-in site-admin overview.
function healthPaths(domain: BackendDomain): string[] {
  if (domain === "idp") return ["/healthz", "/health"];
  return ["/health"];
}

async function checkHealth(
  url: string,
  domain: BackendDomain
): Promise<{ healthy: boolean; product: string; brute_force_protection_disabled?: true }> {
  const fallback = domain === "idp" ? "identuum-idp" : "identuum-ag";
  let disabled = false;
  for (const path of healthPaths(domain)) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      disabled ||=
        domain === "idp" && res.headers.get("X-Identuum-Brute-Force-Protection") === "disabled";
      if (!res.ok) {
        // Try the next tier's path; a later path may still answer.
        continue;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // Non-JSON response — fall back to generic label.
      }
      return {
        healthy: true,
        product: deriveProductLabel(domain, body),
        ...(disabled ? { brute_force_protection_disabled: true as const } : {}),
      };
    } catch {
      // Network error on this path — try the next one.
    }
  }
  return {
    healthy: false,
    product: fallback,
    ...(disabled ? { brute_force_protection_disabled: true as const } : {}),
  };
}
export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    const unconfigured: StatusResponse = {
      idp: { enabled: false, healthy: null, product: "identuum-idp" },
      ag: { enabled: false, healthy: null, product: "identuum-ag" },
    };
    return NextResponse.json(unconfigured, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const [idpResult, agResult] = await Promise.all([
    cfg.idp.enabled ? checkHealth(idpBaseUrl(cfg), "idp") : Promise.resolve(null),
    cfg.ag.enabled ? checkHealth(agBaseUrl(cfg), "ag") : Promise.resolve(null),
  ]);

  const status: StatusResponse = {
    idp: {
      ...(idpResult?.brute_force_protection_disabled
        ? { brute_force_protection_disabled: true }
        : {}),
      enabled: cfg.idp.enabled,
      healthy: idpResult?.healthy ?? null,
      product: idpResult?.product ?? "identuum-idp",
    },
    ag: {
      enabled: cfg.ag.enabled,
      healthy: agResult?.healthy ?? null,
      product: agResult?.product ?? "identuum-ag",
    },
  };

  return NextResponse.json(status, { status: 200, headers: { "Cache-Control": "no-store" } });
}
