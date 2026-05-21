/**
 * AG operator login page — responsive split-panel layout.
 *
 * Desktop: two-column layout — hero/intro panel left, login card right.
 * Mobile/tablet: single column, login card only.
 *
 * Shows login options:
 *   1. OIDC provider section — fetched server-side from AG's provider
 *      discovery endpoint. Rendered based on login_available and provider
 *      enabled status from AG's license-aware response.
 *   2. Local password form — always shown as an alternative.
 *
 * Security:
 *   - Provider metadata is fetched server-side; internal AG URLs never rendered.
 *   - login_url values from AG are NOT rendered directly; the UI constructs
 *     /api/ag-auth/login?idp=<id> from the provider id.
 *   - Credentials (for local login) are proxied server-to-server.
 *   - No sidebar shown; unauthenticated layout.
 */
import { fetchAgAuthProviders } from "@/lib/ag-auth-providers";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { AgAuthProvider, AgAuthProviderDiscoveryState } from "@/lib/types";
import type { Metadata } from "next";
import { AgAdminLoginForm } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AG Operator Login — Identuum" };

export default async function AgAdminLoginPage() {
  const cfg = loadRuntimeConfig();
  const agUrl = cfg?.ag.enabled ? agBaseUrl(cfg) : null;
  const providerState = await fetchAgAuthProviders(agUrl);

  const enabledProviders = providerState.providers.filter((p) => p.enabled);
  const showDivider =
    providerState.available &&
    providerState.login_available === true &&
    enabledProviders.length > 0;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* ── Left hero panel — desktop only ─────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-col lg:justify-between lg:w-[52%] xl:w-[55%] bg-sky-950 px-12 xl:px-16 py-14 relative overflow-hidden">
        {/* Decorative background shapes */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-15%] right-[-15%] w-[60%] h-[60%] rounded-full bg-sky-800/50 blur-[90px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-900/60 blur-[80px]"
        />

        {/* Top: logo + product name */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="h-9 w-9 bg-white/10 rounded-xl flex items-center justify-center border border-white/10">
              <span className="font-black text-white text-[11px] tracking-tight leading-none">AG</span>
            </div>
            <span className="text-sm font-semibold text-white/80 tracking-wide">Identuum</span>
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-tight mb-5">
            AG<br />Governance
          </h1>
          <p className="text-base text-sky-300 leading-relaxed max-w-xs mb-10">
            Operator control plane for AI agent access, oversight, and compliance.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-4">
            {[
              { icon: "○", label: "Agent session oversight and supervision" },
              { icon: "○", label: "HITL review and CBAA approval flows" },
              { icon: "○", label: "MCP governance and operator controls" },
              { icon: "○", label: "Token lifecycle and capability bounds" },
            ].map(({ icon, label }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="mt-0.5 text-sky-400 text-xs leading-none font-bold">◆</span>
                <span className="text-sm text-sky-200 leading-snug">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom: footer note */}
        <div className="relative z-10">
          <p className="text-xs text-sky-700">identuum-ag — agentic governor</p>
        </div>
      </div>

      {/* ── Right login panel ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:px-8 relative overflow-hidden">
        {/* Subtle background shapes on mobile/right panel */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-8%] right-[-8%] w-[50%] h-[50%] rounded-full bg-sky-100/60 blur-[100px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-8%] left-[-8%] w-[45%] h-[45%] rounded-full bg-amber-50/70 blur-[90px]"
        />

        <div className="relative z-10 w-full max-w-[480px]">
          {/* Mobile-only header (hidden on desktop where left panel shows branding) */}
          <div className="lg:hidden mb-8 text-center flex flex-col items-center gap-3">
            <div className="h-10 w-10 bg-sky-700 rounded-xl flex items-center justify-center shadow-sm">
              <span className="font-black text-white text-[11px] tracking-tight leading-none">AG</span>
            </div>
            <span className="text-2xl font-extrabold tracking-tight text-sky-950">AG Governance</span>
          </div>

          {/* Desktop-only subheading above the card */}
          <div className="hidden lg:block mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">
              Operator sign in
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight text-sky-950">
              Access your instance
            </h2>
          </div>

          {/* Login card */}
          <div className="rounded-[1.75rem] border border-stone-200 bg-white shadow-xl">
            <div className="px-7 sm:px-8 pt-7 sm:pt-8 pb-6 space-y-6">
              {/* OIDC provider section */}
              <AgProviderSection state={providerState} />

              {/* Divider only when clickable providers are shown */}
              {showDivider && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-stone-200" />
                  <span className="text-xs text-stone-400">or</span>
                  <div className="flex-1 h-px bg-stone-200" />
                </div>
              )}

              {/* Local credential form */}
              <div>
                <h3 className="text-sm font-semibold text-sky-950 mb-1 tracking-tight">
                  Operator credentials
                </h3>
                <p className="text-xs text-stone-500 mb-4 leading-relaxed">
                  Sign in with your AG operator account.
                </p>
                <AgAdminLoginForm />
              </div>
            </div>
          </div>

          {/* Mobile footer */}
          <p className="lg:hidden mt-6 text-center text-xs text-stone-400">
            identuum-ag — agentic governor
          </p>
        </div>
      </div>
    </div>
  );
}

function AgProviderSection({ state }: { state: AgAuthProviderDiscoveryState }) {
  if (!state.available && state.error_code) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-medium text-amber-800">Login provider discovery unavailable</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Could not fetch configured login options.{" "}
          <span className="font-mono text-amber-600">{state.error_code}</span>
        </p>
      </div>
    );
  }

  if (!state.available || state.provider_count === 0) {
    return null;
  }

  if (state.login_available === false && state.unavailable_reason === "forbidden_feature") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 space-y-2">
        <p className="text-xs font-medium text-sky-950">OIDC login providers configured</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          OIDC federation is not enabled for this license tier.
        </p>
        {state.providers.length > 0 && (
          <div className="space-y-1 pt-1">
            {state.providers.map((p) => (
              <AgProviderLockedBadge key={p.id} provider={p} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const enabledProviders = state.providers.filter((p) => p.enabled);
  if (enabledProviders.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-sky-950 tracking-tight">Sign in with</p>
      {enabledProviders.map((provider) => (
        <AgProviderButton key={provider.id} provider={provider} />
      ))}
    </div>
  );
}

function AgProviderButton({ provider }: { provider: AgAuthProvider }) {
  const loginHref = `/api/ag-auth/login?idp=${encodeURIComponent(provider.id)}`;

  return (
    <a
      href={loginHref}
      className="flex items-center justify-between w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium text-sky-950 hover:bg-sky-50 hover:border-sky-300 transition-colors"
    >
      <span>{provider.display_name}</span>
      {provider.advanced && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400 bg-stone-100 px-2 py-0.5 rounded-md ml-2">
          Advanced
        </span>
      )}
    </a>
  );
}

function AgProviderLockedBadge({ provider }: { provider: AgAuthProvider }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-stone-400 bg-stone-100 border border-stone-200 select-none">
      <span>{provider.display_name}</span>
      <span className="font-mono text-stone-400 text-[10px] ml-2">unavailable</span>
    </div>
  );
}
