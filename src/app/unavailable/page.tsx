/**
 * /unavailable — THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02).
 *
 * Landing for callers that cannot render the unavailable state in place
 * (server actions and data helpers going through getServerSession()). The
 * layouts render ServiceUnavailable inline; this page exists so an outage
 * met mid-action still ends on an honest screen — never on /login, never
 * with a cleared cookie. Query: cid (correlation id), status, retry (seconds).
 */
import type { Metadata } from "next";
import { ServiceUnavailable } from "@/components/shared/service-unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Temporarily unavailable — Identuum" };

function oneString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default async function UnavailablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cid = oneString(params.cid);
  const statusRaw = oneString(params.status);
  const retryRaw = oneString(params.retry);
  const status = statusRaw && /^\d{3}$/.test(statusRaw) ? Number.parseInt(statusRaw, 10) : null;
  const retry = retryRaw && /^\d+$/.test(retryRaw) ? Number.parseInt(retryRaw, 10) : null;
  return (
    <ServiceUnavailable
      correlationId={cid && /^[A-Za-z0-9._-]{1,64}$/.test(cid) ? cid : null}
      status={status}
      retryAfterSeconds={retry}
      retryHref="/"
    />
  );
}
