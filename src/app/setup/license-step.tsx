"use client";

/**
 * license-step.tsx — CE license upload step rendered inside the
 * appliance first-run setup wizard. Shown ONLY when the IDP backend
 * is the CE distribution AND the runtime reports
 * `license_missing` / `license_invalid` / `license_expired`.
 *
 * Phase 14 / D-IDP-INSTALL-22: the UI is the primary customer path
 * for adding a CE license. Mounting a license file is an advanced
 * operator path that converges on the same backend validation +
 * persistence.
 *
 * The component lives outside `setup-wizard.tsx` because the wizard
 * file is already large and the license step has its own
 * paste/upload affordance, its own state machine, and its own
 * source-invariant test surface.
 *
 * Hard rules pinned by source-invariant tests:
 *   - No reads or writes of localStorage, sessionStorage, or
 *     document.cookie.
 *   - License envelope text never leaves the React state for any
 *     surface other than `uploadLicense()`.
 *   - The setup-code/token plaintext flows in from the parent
 *     component and is forwarded verbatim — the license step does
 *     not generate or mutate it.
 */

import { type LicenseStatusBody, uploadLicense } from "@/lib/idp-license-client";
import { AlertCircle, CheckCircle2, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";

interface Props {
  /**
   * The setup-code/token plaintext the operator already verified
   * via `verifySetupToken`. Forwarded verbatim to the IDP. May be
   * empty when the parent has not yet completed verification — the
   * license-step submit button stays disabled in that case.
   */
  setupToken: string;
  /** Whether the parent already verified the setup code. */
  setupTokenVerified: boolean;
  /**
   * Current license status, as observed by `getLicenseStatus()` at
   * page load or after a previous upload. The step renders different
   * affordance copy for "missing" vs "invalid" vs "expired".
   */
  status: LicenseStatusBody;
  /**
   * Fired after a successful upload so the wizard can advance to the
   * org + admin section. The newly-validated status is passed back.
   */
  onLicenseAccepted: (next: LicenseStatusBody) => void;
}

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

function describeStatus(status: LicenseStatusBody): { title: string; copy: string } {
  switch (status.state) {
    case "license_missing":
      return {
        title: "CE license required",
        copy: "Paste your CE license envelope or upload the .lic file your reseller provided. The wizard will validate it and persist it to the data volume.",
      };
    case "license_invalid":
      return {
        title: "CE license could not be verified",
        copy: "The current license envelope on the data volume failed validation. Upload a valid CE license to continue.",
      };
    case "license_expired":
      return {
        title: "CE license expired",
        copy: "The current license has expired. Upload a renewed CE license to continue.",
      };
    case "license_valid":
      return {
        title: "CE license active",
        copy: "License is active. Continue with the organization and administrator details below.",
      };
  }
}

export function LicenseStep({ setupToken, setupTokenVerified, status, onLicenseAccepted }: Props) {
  const [envelope, setEnvelope] = useState<string>("");
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });

  const summary = describeStatus(status);
  const ready = setupTokenVerified && envelope.trim().length > 0;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setEnvelope(text);
      setUploadState({ kind: "idle" });
    } catch {
      setUploadState({
        kind: "error",
        message: "Could not read the selected file. Try pasting the license text instead.",
      });
    } finally {
      // Reset the input so the same file can be re-selected after an
      // error without re-rendering this whole subtree.
      event.target.value = "";
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setUploadState({ kind: "uploading" });
    const result = await uploadLicense({ setupToken, license: envelope });
    switch (result.kind) {
      case "ok":
        setUploadState({ kind: "ok" });
        // Drop the envelope from React state once the IDP has
        // accepted and persisted it. We do not need to keep
        // license bytes in memory longer than the upload itself.
        setEnvelope("");
        onLicenseAccepted(result.status);
        break;
      case "bad_token":
        setUploadState({
          kind: "error",
          message:
            "Setup code is no longer valid. Re-verify it in the previous step and submit again.",
        });
        break;
      case "setup_token_required":
        setUploadState({
          kind: "error",
          message: "Verify the setup code in the previous step before uploading a license.",
        });
        break;
      case "admin_upload_pending":
        setUploadState({
          kind: "error",
          message: result.message,
        });
        break;
      case "rejected":
        setUploadState({
          kind: "error",
          message: rejectionCopy(result.code, result.message),
        });
        break;
      case "unreachable":
        setUploadState({
          kind: "error",
          message: "Could not reach the identity provider. Check the IDP container.",
        });
        break;
      default:
        setUploadState({
          kind: "error",
          message: `License upload failed (HTTP ${result.status}).`,
        });
    }
  }

  return (
    <section
      aria-labelledby="setup-license"
      className="flex flex-col gap-3"
      data-testid="setup-license-step"
    >
      <h2
        id="setup-license"
        className="text-sm font-semibold uppercase tracking-wide text-stone-500"
      >
        CE license
      </h2>
      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 leading-relaxed">
        <p className="flex items-start gap-2 font-medium">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
          <span>{summary.title}</span>
        </p>
        <p className="mt-1 text-stone-600">{summary.copy}</p>
        <p className="mt-2 text-xs text-stone-500">
          The license envelope is validated and persisted to your data volume. Some CE-only features
          mount their HTTP surfaces at startup; activating those may require a one-time container
          restart after upload.
        </p>
      </div>

      <form onSubmit={handleUpload} className="flex flex-col gap-3" noValidate>
        <label htmlFor="license_envelope" className="text-sm text-sky-950">
          Paste the CE license envelope
        </label>
        <textarea
          id="license_envelope"
          name="license_envelope"
          rows={6}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          value={envelope}
          onChange={(e) => {
            setEnvelope(e.target.value);
            if (uploadState.kind === "ok" || uploadState.kind === "error") {
              setUploadState({ kind: "idle" });
            }
          }}
          disabled={!setupTokenVerified || uploadState.kind === "uploading"}
          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-sky-950 shadow-sm font-mono placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed"
          placeholder='{"envelope_version":2,"key_id":"...","license":"...","signature":"..."}'
          data-testid="setup-license-envelope"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="license_file"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm cursor-pointer hover:bg-stone-50 disabled:opacity-70 disabled:cursor-not-allowed"
            data-testid="setup-license-file-label"
          >
            <FileUp aria-hidden="true" className="h-4 w-4" />
            Choose a .lic file
            <input
              id="license_file"
              name="license_file"
              type="file"
              accept=".lic,application/json,text/plain"
              onChange={handleFileChange}
              disabled={!setupTokenVerified || uploadState.kind === "uploading"}
              className="sr-only"
              data-testid="setup-license-file-input"
            />
          </label>

          <button
            type="submit"
            disabled={!ready || uploadState.kind === "uploading" || uploadState.kind === "ok"}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
            data-testid="setup-license-upload"
          >
            {uploadState.kind === "uploading" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : uploadState.kind === "ok" ? (
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            ) : null}
            {uploadState.kind === "ok" ? "License accepted" : "Upload license"}
          </button>
        </div>

        {uploadState.kind === "error" ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-rose-700"
            data-testid="setup-license-error"
          >
            <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{uploadState.message}</span>
          </p>
        ) : null}
        {uploadState.kind === "ok" ? (
          <output
            className="flex items-start gap-2 text-sm text-emerald-700"
            data-testid="setup-license-ok"
          >
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
            <span>License accepted. Continue with the organization and administrator details.</span>
          </output>
        ) : null}
      </form>
    </section>
  );
}

function rejectionCopy(
  code:
    | "license_envelope_required"
    | "license_envelope_malformed"
    | "license_invalid"
    | "license_expired"
    | "license_product_mismatch"
    | "license_persist_failed"
    | "license_persist_path_unset",
  fallback: string
): string {
  switch (code) {
    case "license_envelope_required":
      return "Paste the CE license envelope or choose a license file before submitting.";
    case "license_envelope_malformed":
      return "The license envelope is not in the expected format. Check that you copied the full file contents.";
    case "license_invalid":
      return "The license envelope failed signature verification. Confirm you uploaded the file your reseller provided.";
    case "license_expired":
      return "This license has expired. Contact your reseller for a renewed license.";
    case "license_product_mismatch":
      return "This license is for a different product. Upload an identuum-idp CE license.";
    case "license_persist_failed":
      return (
        fallback ||
        "License accepted but could not be written to the data volume. Check filesystem permissions and try again."
      );
    case "license_persist_path_unset":
      return (
        fallback ||
        "CE was started without a license file path. Restart with --license-file or --data-dir set."
      );
  }
}
