/**
 * AG operator login page.
 *
 * Shows login options:
 *   1. OIDC provider section — fetched server-side from AG's provider
 *      discovery endpoint. Rendered based on login_available and provider
 *      enabled status from AG's license-aware response.
 *   2. Local password form — always shown as an alternative.
 *
 * License awareness:
 *   - login_available=true: render clickable provider login choices.
 *   - login_available=false + forbidden_feature: show license-gate notice;
 *     providers are shown as configured but not clickable.
 *   - providers=[]: no OIDC section; local form is sufficient.
 *   - discovery failed (503): degraded notice; no clickable provider links.
 *
 * Security:
 *   - Provider metadata is fetched server-side; internal AG URLs never rendered.
 *   - login_url values from AG are NOT rendered directly; the UI constructs
 *     /api/ag-auth/login?idp=<id> from the provider id.
 *   - Credentials (for local login) are proxied server-to-server.
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
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-700 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-[11px] tracking-tight leading-none">
              AG
            </span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">AG Governance</span>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6 space-y-6">
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
              <h2 className="text-sm font-semibold text-sky-950 mb-1 tracking-tight">
                Operator sign in
              </h2>
              <p className="text-xs text-stone-500 mb-4 leading-relaxed">
                Sign in with AG operator credentials.
              </p>
              <AgAdminLoginForm />
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">identuum-ag — agentic governor</p>
      </div>
    </div>
  );
}

function AgProviderSection({ state }: { state: AgAuthProviderDiscoveryState }) {
  // Discovery error (503 or unreachable).
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

  // Not configured or no providers -- no OIDC section; local form is sufficient.
  if (!state.available || state.provider_count === 0) {
    return null;
  }

  // Providers configured but OIDCFederation not licensed.
  if (state.login_available === false && state.unavailable_reason === "forbidden_feature") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 space-y-2">
        <p className="text-xs font-medium text-sky-950">OIDC login providers configured</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          AG OIDC login providers are configured, but OIDC federation is not enabled for this
          license.
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

  // login_available=true -- render clickable choices for enabled providers only.
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
  // Route through /api/ag-auth/login?idp=<id> -- never expose AG identity surface URL.
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
  // Disabled provider shown without a clickable link.
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-stone-400 bg-stone-100 border border-stone-200 select-none">
      <span>{provider.display_name}</span>
      <span className="font-mono text-stone-400 text-[10px] ml-2">unavailable</span>
    </div>
  );
}
