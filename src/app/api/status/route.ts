import { deriveProductLabel } from "@/lib/backend-product-labels";
import type { BackendDomain } from "@/lib/backend-product-labels";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { StatusResponse } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// healthPath returns the liveness path each backend mounts. identuum-idp-ce
// uses the Kubernetes-convention `/healthz` (registered in
// cmd/identuum-idp/serve.go and the symmetric upgrade_serve.go); the same
// path is also wired into the UI container's own Dockerfile HEALTHCHECK.
// identuum-ag still publishes `/health` today; this helper preserves that
// AG-side behaviour until a paired AG-side audit confirms the Kubernetes
// convention is universal on the AG binary too. Pinned by
// src/__tests__/api-status-health-paths.test.ts so a future refactor
// cannot silently regress the IDP probe back to `/health` and surface a
// false "identuum-idp unreachable" on the logged-in site-admin overview.
function healthPath(domain: BackendDomain): string {
  if (domain === "idp") return "/healthz";
  return "/health";
}

async function checkHealth(
  url: string,
  domain: BackendDomain
): Promise<{ healthy: boolean; product: string }> {
  const fallback = domain === "idp" ? "identuum-idp" : "identuum-ag";
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}${healthPath(domain)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { healthy: false, product: fallback };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Non-JSON response — fall back to generic label.
    }
    return { healthy: true, product: deriveProductLabel(domain, body) };
  } catch {
    return { healthy: false, product: fallback };
  }
}

export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    const unconfigured: StatusResponse = {
      idp: { enabled: false, healthy: null, product: "identuum-idp" },
      ag: { enabled: false, healthy: null, product: "identuum-ag" },
    };
    return NextResponse.json(unconfigured, { status: 200 });
  }

  const [idpResult, agResult] = await Promise.all([
    cfg.idp.enabled ? checkHealth(idpBaseUrl(cfg), "idp") : Promise.resolve(null),
    cfg.ag.enabled ? checkHealth(agBaseUrl(cfg), "ag") : Promise.resolve(null),
  ]);

  const status: StatusResponse = {
    idp: {
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

  return NextResponse.json(status, { status: 200 });
}
