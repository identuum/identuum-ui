/**
 * AG governance overview page.
 *
 * Shows:
 *   - Deployment mode (governor-only / hybrid)
 *   - AG backend connection status (health check via server-side fetch)
 *   - AG management surface URL (public, safe to display)
 *   - Placeholder governance cards for future AG CRUD surfaces
 *
 * No authentication is required to view this page. AG operator actions
 * require using the AG management surface directly until AG-native
 * operator session integration is implemented.
 *
 * Security:
 *   - Only ag.public_base_url is displayed — never internal_base_url.
 *   - No tokens, session cookies, or credentials are read or displayed.
 *   - Health check is performed server-side; no internal URLs reach the browser.
 */
import { agBaseUrl, loadRuntimeConfig, runtimeMode } from "@/lib/runtime-config";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AG Governance — Identuum" };

async function checkAgHealth(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

export default async function AgAdminPage() {
  const cfg = loadRuntimeConfig();
  const mode = runtimeMode(cfg);
  const agHealthy = cfg?.ag.enabled ? await checkAgHealth(agBaseUrl(cfg)) : null;
  // Only the public URL is shown in the browser — never the internal URL.
  const agPublicUrl = cfg?.ag.public_base_url ?? null;

  const modeLabel =
    mode === "governor-only"
      ? "Governor-only"
      : mode === "hybrid"
        ? "Hybrid (IdP + AG)"
        : mode === "auth-service"
          ? "Auth-service (IdP only)"
          : "Unconfigured";

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">AG Governance</h1>
        <p className="text-sm text-stone-500 mt-0.5">Agentic Governor overview and status</p>
      </div>

      {/* Deployment mode */}
      <Card title="Deployment mode">
        <InfoRow label="Mode" value={modeLabel} />
        <InfoRow
          label="IdP"
          value={cfg?.idp.enabled ? "Enabled" : "Disabled"}
          variant={cfg?.idp.enabled ? "ok" : "neutral"}
        />
        <InfoRow
          label="AG"
          value={cfg?.ag.enabled ? "Enabled" : "Disabled"}
          variant={cfg?.ag.enabled ? "ok" : "neutral"}
        />
        {mode === "governor-only" && (
          <div className="mt-3 rounded-lg bg-sky-50 border border-sky-100 px-4 py-3">
            <p className="text-xs text-sky-700 leading-relaxed">
              <strong>Governor-only deployment.</strong> Human identity login (IdP) is not
              available. Agent governance and agentic token exchange are the primary surfaces.
              Operator authentication uses the AG management interface directly.
            </p>
          </div>
        )}
      </Card>

      {/* AG backend health */}
      <Card title="AG backend">
        <InfoRow
          label="Connection"
          value={agHealthy === true ? "Healthy" : agHealthy === false ? "Unreachable" : "Unknown"}
          variant={agHealthy === true ? "ok" : agHealthy === false ? "error" : "neutral"}
        />
        {agPublicUrl && <InfoRow label="Management surface" value={agPublicUrl} mono />}
      </Card>

      {/* Governance surfaces */}
      <div>
        <h2 className="text-base font-semibold text-sky-950 mb-3">Governance surfaces</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GovernanceCard
            title="Agent Registry"
            description="Agent identities, capability ceilings, and allowed-tools configuration."
            href="/ag-admin/agents"
          />
          <GovernanceCard
            title="Agent Sessions"
            description="Active agent sessions, token exchange history, and revocation status."
            href="/ag-admin/sessions"
          />
          <GovernanceCard
            title="HITL / CBAA"
            description="Human-in-the-loop gate interventions awaiting operator review."
            href="/ag-admin/hitl"
          />
          <GovernanceCard
            title="MCP Server"
            description="Management MCP server status and natural-language governance tools."
            href="/ag-admin/mcp"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
      </div>
      <div className="px-6 py-5 space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  variant = "neutral",
  mono = false,
}: {
  label: string;
  value: string;
  variant?: "ok" | "error" | "neutral";
  mono?: boolean;
}) {
  const valueCls =
    variant === "ok"
      ? "text-emerald-700 font-semibold"
      : variant === "error"
        ? "text-red-600 font-semibold"
        : mono
          ? "text-stone-600 font-mono text-xs"
          : "text-stone-600";

  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-stone-500 shrink-0">{label}</span>
      <span className={`text-sm text-right truncate max-w-xs ${valueCls}`}>{value}</span>
    </div>
  );
}

function GovernanceCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm p-5 hover:border-sky-200 hover:shadow-md transition-all block"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-950">{title}</p>
          <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{description}</p>
        </div>
        <span className="shrink-0 text-stone-300 mt-0.5">→</span>
      </div>
    </a>
  );
}
