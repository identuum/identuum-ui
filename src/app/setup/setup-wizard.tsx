"use client";

import type { LicenseStatusBody } from "@/lib/idp-license-client";
import { type CompleteSetupInput, completeSetup, verifySetupToken } from "@/lib/idp-setup-client";
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
  | { kind: "submitting" }
  | { kind: "ok" }
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

  const [orgName, setOrgName] = useState("");
  const [orgDomain, setOrgDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

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

  const licenseAccepted =
    !distributionIsCE || licenseStatus === null || licenseStatus.state === "license_valid";

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
    setSubmitState({ kind: "submitting" });

    const input: CompleteSetupInput = {
      setupToken: setupCode.trim(),
      organizationName: orgName.trim(),
      organizationDomain: orgDomain.trim(),
      adminEmail: adminEmail.trim(),
      adminPassword,
    };

    const result = await completeSetup(input);
    switch (result.kind) {
      case "ok":
        setSubmitState({ kind: "ok" });
        // Brief pause so the operator sees the success state before redirect.
        window.setTimeout(() => router.replace("/login"), 600);
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

      {/* Section 3 — organization + site administrator */}
      <section aria-labelledby="setup-org" className="flex flex-col gap-3">
        <h2 id="setup-org" className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Organization and site administrator
        </h2>
        <form
          onSubmit={handleComplete}
          className="flex flex-col gap-4"
          aria-disabled={!codeVerified || !licenseAccepted}
          noValidate
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              submitState.kind === "submitting" ||
              submitState.kind === "ok" ||
              !orgName.trim() ||
              !orgDomain.trim() ||
              !adminEmail.trim() ||
              adminPassword.length < MIN_PASSWORD_LENGTH ||
              !passwordsMatch
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
            data-testid="setup-submit"
          >
            {submitState.kind === "submitting" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : null}
            {submitState.kind === "submitting"
              ? "Finishing setup…"
              : submitState.kind === "ok"
                ? "Setup complete"
                : "Complete first-run setup"}
          </button>

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
            <output
              className="flex items-start gap-2 text-sm text-emerald-700"
              data-testid="setup-submit-ok"
            >
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Setup complete. Redirecting you to sign in…</span>
            </output>
          ) : null}
        </form>
      </section>
    </div>
  );
}
