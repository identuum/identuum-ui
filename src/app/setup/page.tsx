import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLicenseStatus, type LicenseStatusBody } from "@/lib/idp-license-client";
import { getSetupStatus } from "@/lib/idp-setup-client";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { SetupWizard } from "./setup-wizard";

/**
 * Server-only absolute-URL probe for `/api/setup/license`. Mirrors the
 * relative-URL `getLicenseStatus()` projection but goes through the
 * runtime config's `idp.internal_base_url`. Used as fallback in the
 * SSR path because Node's native fetch cannot resolve relative URLs
 * from Next.js server components in standalone production builds
 * (observed during the 2026-06-15 CE customer-smoke). Returns null
 * on any failure (timeout / non-200 / non-JSON / unknown shape) so
 * the wizard falls back to the recovery banner the same way the
 * relative probe failure does.
 *
 * No envelope material, no signing key, no operator credential reads
 * — the IDP `/api/setup/license` endpoint deliberately returns a
 * no-secrets status view (see internal/license/upload.go).
 */
async function fetchLicenseStatusAbsolute(baseUrl: string): Promise<LicenseStatusBody | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/setup/license`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const state = raw.state;
    if (
      state !== "license_missing" &&
      state !== "license_valid" &&
      state !== "license_invalid" &&
      state !== "license_expired"
    ) {
      return null;
    }
    return {
      state,
      distribution: typeof raw.distribution === "string" ? raw.distribution : "",
      product: typeof raw.product === "string" ? raw.product : "",
      tier: typeof raw.tier === "string" ? raw.tier : undefined,
      licensee: typeof raw.licensee === "string" ? raw.licensee : undefined,
      expiresAt: typeof raw.expires_at === "string" ? raw.expires_at : undefined,
      licenseId: typeof raw.license_id === "string" ? raw.license_id : undefined,
      licenseType: typeof raw.license_type === "string" ? raw.license_type : undefined,
      nextAction: typeof raw.next_action === "string" ? raw.next_action : undefined,
    };
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "First-run setup — Identuum" };

/**
 * `/setup` is the customer-facing first-run setup wizard for
 * self-hosted Identuum IDP. It is shown only while the IDP reports
 * `state=setup_required` from `GET /api/setup/status`; once the
 * wizard succeeds the IDP flips to `setup_complete` and this page
 * forwards to `/login`.
 *
 * Note the deliberate distinction from `/setup-required`: that page
 * is shown when the UI itself has not been configured (no runtime
 * config file). This page is shown when the UI is configured and the
 * IDP needs first-run setup. Both copies are honest about their
 * scope per the appliance install UX decisions.
 */
export default async function SetupPage() {
  // If the UI runtime config is missing, the older /setup-required
  // page still owns that boundary; we don't try to handle both states
  // in one place.
  const cfg = loadRuntimeConfig();
  if (!cfg) {
    redirect("/setup-required");
  }

  // Server-side runtime composition is the AUTHORITATIVE source for
  // the IDP's setup state on this page. It uses an absolute IDP base
  // URL composed from the runtime config (idp.internal_base_url) and
  // calls fetchIdpSetupState directly — independent of the relative-
  // path `/api/idp/...` proxy that getSetupStatus() walks. When the
  // bundled UI runs in a Compose container that has a working
  // in-network DNS path to the IDP service but a flaky same-origin
  // proxy (observed during the 2026-06-15 CE customer-smoke), the
  // proxy-based probe can fall through to a probe-failure result
  // while the runtime composition still sees setup_complete. We
  // redirect in that case BEFORE running the relative-URL probe so
  // the page reliably forwards completed installs to /login.
  const runtime = await getServerRuntimeState();
  if (runtime?.components.idp.setupState?.state === "setup_complete") {
    redirect("/login");
  }

  // Probe setup + license state in parallel so a slow IDP boot does
  // not double the page TTFB. The license probe is best-effort —
  // older OSS backends do not expose the endpoint, and the wizard
  // gracefully falls back to "no CE license step" in that case.
  const [status, licenseProbe] = await Promise.all([getSetupStatus(), getLicenseStatus()]);

  if (status.kind === "ok" && status.status.state === "setup_complete") {
    // Defense in depth (relative-URL probe path): a stale tab landing
    // here after completion goes straight to login rather than showing
    // a confusing empty wizard. The earlier server-runtime check above
    // catches the absolute-URL path; this catch fires when only the
    // proxy path returns a usable setup_complete signal.
    redirect("/login");
  }

  // Build the wizard's initial status. Preference order:
  //   1. The relative-URL setup-status probe when it succeeds —
  //      cheapest, no extra plumbing.
  //   2. The absolute-URL runtime composition probe as fallback —
  //      Node's native fetch cannot resolve relative URLs in Next.js
  //      server components running under standalone production builds
  //      (observed during the 2026-06-15 CE customer-smoke: the
  //      bundled-UI proxy returns 200 to curl/exec, but the SSR
  //      fetcher fails with "Failed to parse URL"). Without this
  //      fallback the wizard would silently render as OSS, blocking
  //      the CE license step and letting setup complete against an
  //      unlicensed CE backend.
  const idpRuntime = runtime?.components.idp;
  const initial =
    status.kind === "ok"
      ? {
          state: status.status.state,
          nextAction: status.status.nextAction,
          siteAdminExists: status.status.siteAdminExists,
          firstOrganizationExists: status.status.firstOrganizationExists,
          firstSigningKeyExists: status.status.firstSigningKeyExists,
          distribution: status.status.distribution,
        }
      : idpRuntime?.setupState
        ? {
            state: idpRuntime.setupState.state,
            nextAction: idpRuntime.setupState.nextAction,
            siteAdminExists: idpRuntime.setupState.siteAdminExists,
            firstOrganizationExists: idpRuntime.setupState.firstOrganizationExists,
            firstSigningKeyExists: idpRuntime.setupState.firstSigningKeyExists,
            // Derive distribution from the product identifier on the
            // absolute /api/v1/component probe — IdpSetupStateView
            // deliberately omits the distribution field, so we infer it
            // here from the sibling product field. Anything other than
            // the explicit CE product id is treated as OSS.
            distribution: idpRuntime.product === "identuum-idp-ce" ? "ce" : "oss",
          }
        : null;

  // License probe result: only forward the body when the resolved
  // initial reports CE distribution. OSS deployments never need the
  // CE license step. Preference order mirrors the setup-state path:
  //   1. The relative-URL `getLicenseStatus()` probe when it succeeded.
  //   2. The absolute-URL `fetchLicenseStatusAbsolute(idpBaseUrl)`
  //      fallback. Without this fallback the LicenseStep would never
  //      render on stacks where the SSR proxy fails — the wizard
  //      would surface only the recovery banner and the operator
  //      could never upload a license through the wizard at all.
  let initialLicenseStatus: LicenseStatusBody | null = null;
  if (initial?.distribution === "ce") {
    if (licenseProbe.kind === "ok") {
      initialLicenseStatus = licenseProbe.status;
    } else {
      initialLicenseStatus = await fetchLicenseStatusAbsolute(idpBaseUrl(cfg));
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Subtle ambient warmth, consistent with the new visual language. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-xl">
        {/* Wordmark + logo mark */}
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 py-8">
            <h1 className="text-xl font-bold text-sky-950 tracking-tight">First-run setup</h1>
            <p className="mt-1 text-sm text-stone-500 leading-relaxed">
              Welcome to your self-hosted Identuum IDP installation. This wizard finishes the
              first-run setup. It runs once.
            </p>

            <SetupWizard initialStatus={initial} initialLicenseStatus={initialLicenseStatus} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          identuum — single-node self-hosted install
        </p>
      </div>
    </div>
  );
}
