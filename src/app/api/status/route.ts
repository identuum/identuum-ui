import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { StatusResponse } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    const unconfigured: StatusResponse = {
      idp: { enabled: false, healthy: null },
      ag: { enabled: false, healthy: null },
    };
    return NextResponse.json(unconfigured, { status: 200 });
  }

  const [idpHealthy, agHealthy] = await Promise.all([
    cfg.idp.enabled ? checkHealth(idpBaseUrl(cfg)) : Promise.resolve(null),
    cfg.ag.enabled ? checkHealth(agBaseUrl(cfg)) : Promise.resolve(null),
  ]);

  const status: StatusResponse = {
    idp: { enabled: cfg.idp.enabled, healthy: idpHealthy },
    ag: { enabled: cfg.ag.enabled, healthy: agHealthy },
  };

  return NextResponse.json(status, { status: 200 });
}
