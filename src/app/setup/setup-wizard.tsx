"use client";

import type { LicenseStatusBody } from "@/lib/idp-license-client";
import { type CompleteSetupInput, completeSetup, verifySetupToken } from "@/lib/idp-setup-client";
import { initiateSetupMFA, verifySetupMFA } from "@/lib/idp-setup-mfa-client";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { LicenseStep } from "./license-step";

interface InitialStatus {
  state: "setup_required" | "setup_complete";
  nextAction: string;
  siteAdminExists: boolean;
  firstOrganizationExists: boolean;
  firstSigningKeyExists: boolean;
  distribution: string;
}

interface Props {
  initialStatus: InitialStatus | null;
  /**
   * License status fetched server-side at page load. Null when the
   * backend is not the CE distribution OR the license endpoint
   * could not be reached (older backend, network failure). The
   * wizard only renders the CE license step when this is non-null
   * AND the embedded state is missing/invalid/expired AND the
   * setup-status distribution reports `ce`.
   */
  initialLicenseStatus: LicenseStatusBody | null;
}

type CodeState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "initiating_mfa" }
  // D-IDP-INSTALL-26 — operator has filled the email/password form
  // and the wizard has called initiateSetupMFA. The session_id +
  // otpauth_url + secret live in component state ONLY during this
  // phase; they are wiped on transition to "submitting" / "ok" /
  // "error". The secret is rendered to the screen but never logged
  // and never persisted to any browser-side storage API or to the
  // URL. agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation.
  | {
      kind: "mfa_pending";
      sessionId: string;
      otpauthUrl: string;
      secret: string;
      verifyError: string | null;
    }
  | { kind: "verifying_mfa"; sessionId: string; otpauthUrl: string; secret: string }
  | { kind: "submitting" }
  | { kind: "ok"; recoveryCodes: string[] }
  | { kind: "error"; message: string };

const MIN_PASSWORD_LENGTH = 12;

/**
 * SetupWizard is a single-page three-section first-run wizard:
 *
 *   1. Intro (read-only — explains what the wizard does and where the
 *      setup code lives).
 *   2. Setup code verification — operator pastes the code from the
 *      IDP container logs / `--show-setup-code <data-dir>`.
 *   3. First organization + site administrator — operator picks the
 *      organization name, the admin email, and the admin password.
 *
 * The org+admin form is enabled only after the setup code is
 * verified. Submitting calls `completeSetup`; on success we navigate
 * to `/login`.
 */
export function SetupWizard({ initialStatus, initialLicenseStatus }: Props) {
  const router = useRouter();

  const [setupCode, setSetupCode] = useState("");
  const [codeState, setCodeState] = useState<CodeState>({ kind: "idle" });

  // createTenantOrg defaults to FALSE (site-admin-only bootstrap). The
  // operator opts in via the checkbox below; only then are the org
  // name + domain fields shown and required. The IDP ignores the org
  // fields entirely when create_tenant_org=false, so the wizard does
  // not even need to wipe orgName/orgDomain when the operator toggles
  // the checkbox off — they will be ignored on submit.
  const [createTenantOrg, setCreateTenantOrg] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgDomain, setOrgDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  // D-IDP-INSTALL-26 — TOTP verification code the operator types in
  // the MFA-pending panel. Held only in this React hook's state and
  // wiped on every transition out of the MFA panel. Never logged.
  const [mfaCode, setMfaCode] = useState("");

  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusBody | null>(
    initialLicenseStatus
  );

  const codeVerified = codeState.kind === "ok";
  const passwordsMatch = adminPassword === confirmPassword;

  // Render the CE license step only when the IDP backend is the CE
  // distribution AND the current license state needs operator
  // attention. OSS backends never carry license state, so the step
  // stays hidden. When the backend reports `license_valid` the step
  // collapses into a non-blocking confirmation banner instead of a
  // full upload form (the operator can still upload a replacement
  // later from the admin path — deferred follow-on slice).
  const distributionIsCE = initialStatus?.distribution === "ce";
  const showLicenseStep =
    distributionIsCE && licenseStatus !== null && licenseStatus.state !== "license_valid";

  // For a CE backend, a missing licenseStatus value (probe failed
  // server-side — same relative-URL path used by the setup-status
  // probe that 044aa0e patched) means we have NO evidence the CE
  // binary has a valid license. Permitting setup completion in that
  // state lets the appliance boot in `oss_compat` mode with
  // `license_state=missing` and silently breaks the login surface
  // afterwards (operator-confirmed 2026-06-15 customer-smoke:
  // `mode=oss_compat license_state=missing par_reason=disabled_unlicensed`,
  // wizard succeeded, login returned "Login failed. Try again.").
  // Treat null as "probe failed" — block submission and surface a
  // recovery banner. The OSS / older-backend fall-through case
  // remains intact because `!distributionIsCE` short-circuits first.
  const licenseProbeUnavailableForCE = distributionIsCE && licenseStatus === null;
  const licenseAccepted = !distributionIsCE || licenseStatus?.state === "license_valid";

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    if (!setupCode.trim()) {
      setCodeState({ kind: "error", message: "Enter the setup code from the IDP logs." });
      return;
    }
    setCodeState({ kind: "verifying" });
    const result = await verifySetupToken(setupCode.trim());
    switch (result.kind) {
      case "ok":
        setCodeState({ kind: "ok" });
        break;
      case "bad_token":
        setCodeState({
          kind: "error",
          message: "Setup code is not correct. Try the one printed in the IDP container logs.",
        });
        break;
      case "already_complete":
        // Race: another browser tab finished the wizard while we were on this page.
        router.replace("/login");
        break;
      case "unreachable":
        setCodeState({
          kind: "error",
          message:
            "Could not reach the identity provider. Check that the IDP container is running.",
        });
        break;
      default:
        setCodeState({
          kind: "error",
          message: `Setup code check failed (HTTP ${result.status}).`,
        });
    }
  }

  // handleComplete is now a two-stage flow per D-IDP-INSTALL-26:
  //
  //   stage 1 — operator clicks "Complete setup": wizard validates
  //             the form locally, then calls /api/setup/mfa/initiate
  //             which returns the otpauth URL + secret + session id.
  //             The wizard transitions to "mfa_pending" and renders
  //             the QR + secret + code entry panel.
  //
  //   stage 2 — operator scans the QR / pairs an authenticator app /
  //             enters the 6-digit code and clicks "Verify and
  //             finish": wizard calls /api/setup/mfa/verify; on
  //             success it calls /api/setup/complete with the
  //             session id + code threaded through; on the IDP's
  //             200 the success screen surfaces the recovery codes
  //             ONCE and redirects to /login.
  //
  // The setup token, organization, email, and password fields stay
  // captured in their existing useState hooks so a back-button or
  // page reload does not lose them. The MFA session id + secret +
  // otpauth URL live ONLY inside the SubmitState union for the
  // duration of the "mfa_pending" / "verifying_mfa" phases.
  // agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation.
  async function handleComplete(event: FormEvent) {
    event.preventDefault();
    if (!codeVerified) return;
    if (!passwordsMatch) {
      setSubmitState({ kind: "error", message: "The two password entries do not match." });
      return;
    }
    if (adminPassword.length < MIN_PASSWORD_LENGTH) {
      setSubmitState({
        kind: "error",
        message: `Site administrator password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    setSubmitState({ kind: "initiating_mfa" });

    const initiateResult = await initiateSetupMFA(setupCode.trim(), adminEmail.trim());
    if (initiateResult.kind !== "ok") {
      const message =
        initiateResult.kind === "bad_token"
          ? "Setup code is no longer valid. Re-verify it before continuing."
          : initiateResult.kind === "already_complete"
            ? "Setup has already been completed on this installation."
            : initiateResult.kind === "subsystem_not_configured"
              ? "MFA subsystem is not configured on the IDP. Restart with the key-wrap provider wired."
              : initiateResult.kind === "unreachable"
                ? "Could not reach the identity provider while preparing MFA enrollment."
                : `MFA enrollment could not be started (HTTP ${initiateResult.status}).`;
      setSubmitState({ kind: "error", message });
      return;
    }

    setMfaCode("");
    setSubmitState({
      kind: "mfa_pending",
      sessionId: initiateResult.result.sessionId,
      otpauthUrl: initiateResult.result.otpauthUrl,
      secret: initiateResult.result.secret,
      verifyError: null,
    });
  }

  async function handleVerifyAndFinishMFA() {
    if (submitState.kind !== "mfa_pending") return;
    const sessionId = submitState.sessionId;
    const otpauthUrl = submitState.otpauthUrl;
    const secret = submitState.secret;
    if (mfaCode.trim().length < 6) {
      setSubmitState({
        ...submitState,
        verifyError: "Enter the 6-digit code from your authenticator.",
      });
      return;
    }
    setSubmitState({ kind: "verifying_mfa", sessionId, otpauthUrl, secret });

    const verifyResult = await verifySetupMFA(
      setupCode.trim(),
      sessionId,
      adminEmail.trim(),
      mfaCode.trim()
    );
    if (verifyResult.kind !== "ok") {
      const message =
        verifyResult.kind === "code_invalid"
          ? "That code did not match. Try the current code from your authenticator."
          : verifyResult.kind === "session_invalid"
            ? "MFA session expired. Restart the setup wizard to re-enroll."
            : verifyResult.kind === "email_mismatch"
              ? "Admin email changed since MFA enrollment started. Restart MFA enrollment."
              : verifyResult.kind === "bad_token"
                ? "Setup code is no longer valid. Re-verify it before continuing."
                : verifyResult.kind === "already_complete"
                  ? "Setup has already been completed on this installation."
                  : verifyResult.kind === "unreachable"
                    ? "Could not reach the identity provider while verifying MFA code."
                    : `MFA verification failed (HTTP ${verifyResult.status}).`;
      setSubmitState({ kind: "mfa_pending", sessionId, otpauthUrl, secret, verifyError: message });
      return;
    }

    setSubmitState({ kind: "submitting" });
    const input: CompleteSetupInput = {
      setupToken: setupCode.trim(),
      createTenantOrg,
      // When createTenantOrg is false the IDP ignores both fields; we
      // still forward the trimmed values so a re-toggled "yes, create
      // one" path picks up whatever the operator typed previously
      // without forcing a re-entry.
      organizationName: createTenantOrg ? orgName.trim() : "",
      organizationDomain: createTenantOrg ? orgDomain.trim() : "",
      adminEmail: adminEmail.trim(),
      adminPassword,
      adminMFASessionId: sessionId,
      adminMFACode: mfaCode.trim(),
    };
    // Wipe local code state immediately — the server has the verified
    // copy now; the wizard never needs the plaintext again.
    setMfaCode("");
    const result = await completeSetup(input);
    switch (result.kind) {
      case "ok":
        setSubmitState({ kind: "ok", recoveryCodes: result.result.recoveryCodes });
        break;
      case "bad_token":
        setCodeState({
          kind: "error",
          message: "Setup code is no longer valid. Re-verify it before submitting the form again.",
        });
        setSubmitState({ kind: "idle" });
        break;
      case "already_complete":
        router.replace("/login");
        break;
      case "mfa_required":
      case "mfa_session_invalid":
      case "mfa_code_invalid":
        setSubmitState({
          kind: "error",
          message:
            "MFA verification expired between steps. Restart the wizard to enroll the site administrator authenticator.",
        });
        break;
      case "invalid":
        setSubmitState({ kind: "error", message: `Setup request rejected: ${result.message}.` });
        break;
      case "unreachable":
        setSubmitState({
          kind: "error",
          message: "Could not reach the identity provider while submitting setup.",
        });
        break;
      default:
        setSubmitState({
          kind: "error",
          message: `Setup completion failed (HTTP ${result.status}).`,
        });
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-8" data-testid="setup-wizard">
      {/* Section 1 — intro / hint */}
      <section aria-labelledby="setup-intro" className="flex flex-col gap-2">
        <h2
          id="setup-intro"
          className="text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Before you begin
        </h2>
        <p className="text-sm text-sky-950 leading-relaxed">
          Locate the setup code your IDP container printed on startup. The same code is stored at{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs text-sky-950">
            $IDENTUUM_IDP_DATA_DIR/setup-token.txt
          </code>{" "}
          inside the container while setup is incomplete, and you can re-display it any time with{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs text-sky-950">
            identuum-idp --show-setup-code &lt;data-dir&gt;
          </code>
          . The setup code is single-use; it authorises this wizard only and is not your
          administrator password.
        </p>
        {initialStatus?.nextAction ? (
          <p className="text-xs text-stone-500 leading-relaxed">
            <strong className="text-stone-700">Next:</strong> {initialStatus.nextAction}
          </p>
        ) : null}
      </section>

      {/* Section 2 — verify code */}
      <section aria-labelledby="setup-code" className="flex flex-col gap-3">
        <h2
          id="setup-code"
          className="text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Setup code
        </h2>
        <form onSubmit={handleVerifyCode} className="flex flex-col gap-3" noValidate>
          <label htmlFor="setup_token" className="text-sm text-sky-950">
            Paste the setup code from the IDP logs
          </label>
          <div className="flex gap-2">
            <div className="relative grow">
              <KeyRound
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400"
              />
              <input
                id="setup_token"
                name="setup_token"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={setupCode}
                onChange={(e) => {
                  setSetupCode(e.target.value);
                  if (codeState.kind === "ok" || codeState.kind === "error") {
                    setCodeState({ kind: "idle" });
                  }
                }}
                disabled={codeVerified || codeState.kind === "verifying"}
                className="w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 py-2 text-sm text-sky-950 shadow-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed font-mono"
                placeholder="ABCDEF…"
                aria-invalid={codeState.kind === "error"}
                data-testid="setup-code-input"
              />
            </div>
            <button
              type="submit"
              disabled={codeState.kind === "verifying" || codeVerified}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
              data-testid="setup-code-verify"
            >
              {codeState.kind === "verifying" ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : codeVerified ? (
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              ) : null}
              {codeVerified ? "Verified" : "Verify code"}
            </button>
          </div>
          {codeState.kind === "error" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="setup-code-error"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{codeState.message}</span>
            </p>
          ) : null}
          {codeVerified ? (
            <output
              className="flex items-start gap-2 text-sm text-emerald-700"
              data-testid="setup-code-ok"
            >
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Setup code accepted. Continue with the organization and administrator details.
              </span>
            </output>
          ) : null}
        </form>
      </section>

      {/* Section 2.5 — CE license (conditional). Shown only when
          the IDP backend is the CE distribution AND the runtime
          reports a license state that requires operator action
          (missing / invalid / expired). OSS deployments and
          already-licensed CE deployments skip straight to the
          org+admin section below. */}
      {showLicenseStep && licenseStatus !== null ? (
        <LicenseStep
          setupToken={setupCode.trim()}
          setupTokenVerified={codeVerified}
          status={licenseStatus}
          onLicenseAccepted={setLicenseStatus}
        />
      ) : null}

      {/* Section 2.5b — CE license probe-unavailable recovery banner.
          Shown when the IDP backend self-identifies as CE but the
          server-side `getLicenseStatus()` probe failed (returned
          unreachable / non-OK). Without this banner the wizard would
          silently treat probe-failure as "no license check needed"
          and let the operator complete setup against an unlicensed
          CE binary, which then boots in oss_compat mode with the
          login surface unmounted (operator-observed regression
          2026-06-15). The org+admin form below disables submit via
          licenseAccepted; this banner explains WHY. */}
      {licenseProbeUnavailableForCE ? (
        <section
          aria-labelledby="setup-license-probe-failed"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
          data-testid="setup-license-probe-unavailable"
        >
          <h2 id="setup-license-probe-failed" className="text-sm font-semibold text-amber-900">
            CE license status unavailable
          </h2>
          <p className="mt-1 text-sm text-amber-900 leading-relaxed">
            The CE backend reports its distribution as <code>ce</code>, but the wizard could not
            reach the <code>/api/setup/license</code> endpoint to verify the license state. Setup
            completion is blocked because an unlicensed CE appliance cannot mount its login surface.
          </p>
          <p className="mt-2 text-sm text-amber-900 leading-relaxed">
            Verify the IDP container is healthy and reachable from the bundled UI, then reload this
            page to retry. If the problem persists, confirm the operator-supplied CE license
            envelope is staged before running the wizard again.
          </p>
        </section>
      ) : null}

      {/* Section 3 — site administrator + optional first tenant org */}
      <section aria-labelledby="setup-org" className="flex flex-col gap-3">
        <h2 id="setup-org" className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Site administrator
        </h2>
        <form
          onSubmit={handleComplete}
          className="flex flex-col gap-4"
          aria-disabled={!codeVerified || !licenseAccepted}
          noValidate
        >
          {/* Optional first tenant organization toggle. Default: off
              (site-admin-only bootstrap). When on, the org name +
              domain fields below become required; when off, the IDP
              ignores them and no tenant org is created. The hidden
              System Organization sentinel is seeded by the IDP at
              boot independently of this choice. */}
          <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <input
              id="create_tenant_org"
              name="create_tenant_org"
              type="checkbox"
              checked={createTenantOrg}
              onChange={(e) => setCreateTenantOrg(e.target.checked)}
              disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
              className="mt-1 h-4 w-4 rounded border-stone-300 text-sky-600 focus:ring-sky-300"
              data-testid="setup-create-tenant-org"
            />
            <label htmlFor="create_tenant_org" className="text-sm text-sky-950 leading-relaxed">
              <span className="font-semibold">
                Also create a first tenant organization (optional).
              </span>{" "}
              <span className="text-stone-600">
                Leave unchecked for a site-admin-only bootstrap; you can create tenant organizations
                from the admin surface after sign-in. Check to provide the first tenant's name and
                domain below.
              </span>
            </label>
          </div>

          {createTenantOrg ? (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              data-testid="setup-tenant-org-fields"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="organization_name" className="text-sm text-sky-950">
                  Organization name
                </label>
                <input
                  id="organization_name"
                  name="organization_name"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
                  required
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  placeholder="Acme Corp"
                  data-testid="setup-org-name"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="organization_domain" className="text-sm text-sky-950">
                  Organization domain
                </label>
                <input
                  id="organization_domain"
                  name="organization_domain"
                  type="text"
                  value={orgDomain}
                  onChange={(e) => setOrgDomain(e.target.value)}
                  disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
                  required
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  placeholder="acme.example"
                  data-testid="setup-org-domain"
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <label htmlFor="admin_email" className="text-sm text-sky-950">
              Site administrator email
            </label>
            <input
              id="admin_email"
              name="admin_email"
              type="email"
              autoComplete="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
              required
              className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
              placeholder="owner@acme.example"
              data-testid="setup-admin-email"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="admin_password" className="text-sm text-sky-950">
                Password
              </label>
              <input
                id="admin_password"
                name="admin_password"
                type="password"
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
                placeholder="At least 12 characters"
                data-testid="setup-admin-password"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="admin_password_confirm" className="text-sm text-sky-950">
                Confirm password
              </label>
              <input
                id="admin_password_confirm"
                name="admin_password_confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={!codeVerified || !licenseAccepted || submitState.kind === "submitting"}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
                placeholder="Re-type the password"
                data-testid="setup-admin-password-confirm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={
              !codeVerified ||
              !licenseAccepted ||
              submitState.kind === "initiating_mfa" ||
              submitState.kind === "mfa_pending" ||
              submitState.kind === "verifying_mfa" ||
              submitState.kind === "submitting" ||
              submitState.kind === "ok" ||
              // Tenant org fields gated on the createTenantOrg
              // toggle. When the checkbox is off the inputs are not
              // rendered at all and must not block submit.
              (createTenantOrg && (!orgName.trim() || !orgDomain.trim())) ||
              !adminEmail.trim() ||
              adminPassword.length < MIN_PASSWORD_LENGTH ||
              !passwordsMatch
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
            data-testid="setup-submit"
          >
            {submitState.kind === "submitting" || submitState.kind === "initiating_mfa" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : null}
            {submitState.kind === "submitting"
              ? "Finishing setup…"
              : submitState.kind === "initiating_mfa"
                ? "Preparing MFA enrollment…"
                : submitState.kind === "mfa_pending" || submitState.kind === "verifying_mfa"
                  ? "Continue MFA enrollment below"
                  : submitState.kind === "ok"
                    ? "Setup complete"
                    : "Continue to MFA enrollment"}
          </button>

          {/* D-IDP-INSTALL-26 — MFA enrollment panel. Renders after the
              wizard has called initiateSetupMFA and received a fresh
              session id + otpauth URL + secret. The QR + secret are
              displayed exactly here and only while submitState.kind is
              "mfa_pending" / "verifying_mfa"; they are wiped from
              component state on any transition out of these phases.
              agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation. */}
          {(submitState.kind === "mfa_pending" || submitState.kind === "verifying_mfa") && (
            <div
              className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4"
              data-testid="setup-mfa-pending"
            >
              <p className="text-sm font-semibold text-sky-950">
                Enroll site administrator authenticator (TOTP)
              </p>
              <p className="text-xs text-stone-600">
                Scan the QR or paste the secret into your authenticator app, then enter the 6-digit
                code below.
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-stone-500">
                  Provisioning URL
                </span>
                <code
                  className="break-all rounded-lg bg-white px-3 py-2 text-xs text-sky-950 shadow-sm"
                  data-testid="setup-mfa-otpauth"
                >
                  {submitState.otpauthUrl}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-stone-500">
                  Secret (base32)
                </span>
                <code
                  className="break-all rounded-lg bg-white px-3 py-2 text-xs text-sky-950 shadow-sm"
                  data-testid="setup-mfa-secret"
                >
                  {submitState.secret}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="setup_mfa_code" className="text-sm text-sky-950">
                  6-digit code
                </label>
                <input
                  id="setup_mfa_code"
                  name="setup_mfa_code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  disabled={submitState.kind === "verifying_mfa"}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tracking-widest text-sky-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  placeholder="123456"
                  data-testid="setup-mfa-code"
                />
              </div>
              <button
                type="button"
                onClick={handleVerifyAndFinishMFA}
                disabled={submitState.kind === "verifying_mfa" || mfaCode.trim().length < 6}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
                data-testid="setup-mfa-verify"
              >
                {submitState.kind === "verifying_mfa" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : null}
                {submitState.kind === "verifying_mfa"
                  ? "Verifying and finishing…"
                  : "Verify and finish setup"}
              </button>
              {submitState.kind === "mfa_pending" && submitState.verifyError ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-sm text-rose-700"
                  data-testid="setup-mfa-error"
                >
                  <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{submitState.verifyError}</span>
                </p>
              ) : null}
            </div>
          )}

          {submitState.kind === "error" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="setup-submit-error"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitState.message}</span>
            </p>
          ) : null}
          {submitState.kind === "ok" ? (
            <div
              className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
              data-testid="setup-submit-ok"
            >
              <output className="flex items-start gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Setup complete. Save your recovery codes below before continuing.</span>
              </output>
              {submitState.recoveryCodes.length > 0 ? (
                <>
                  <p className="text-xs text-stone-600">
                    Recovery codes (shown once; CE will never display them again):
                  </p>
                  <ul
                    className="grid grid-cols-2 gap-2 rounded-xl bg-white p-3 text-xs text-sky-950 shadow-inner"
                    data-testid="setup-recovery-codes"
                  >
                    {submitState.recoveryCodes.map((c) => (
                      <li key={c} className="font-mono">
                        {c}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => router.replace("/login")}
                className="self-start inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
                data-testid="setup-go-to-login"
              >
                Continue to sign in
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
