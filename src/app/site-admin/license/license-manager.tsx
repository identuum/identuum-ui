"use client";

/**
 * LicenseManager — client component backing /site-admin/license.
 *
 * - Holds an admin bearer token in React state ONLY for the duration of the
 *   request. Never persisted to localStorage / sessionStorage / cookies / URL.
 * - Holds a license envelope (paste or file upload) in React state ONLY for
 *   the duration of the upload. Dropped immediately after a successful
 *   response so React's component tree never keeps the bytes around.
 * - Calls the same-origin proxy at `/api/idp/admin/license` via
 *   `adminGetLicenseStatus` / `adminUploadLicense` helpers (no direct
 *   identuum-idp URL). The proxy forwards the Authorization header through
 *   to CE.
 *
 * Source-invariant tests in
 * `src/__tests__/admin-license-page-source-invariants.test.ts` pin the
 * no-persist + no-direct-URL + no-eval-framing rules.
 */

import { useCallback, useState } from "react";
import { LocalTime } from "@/components/ui/local-time";
import {
  type AdminLicenseStatusResult,
  type AdminUploadLicenseResult,
  adminGetLicenseStatus,
  adminUploadLicense,
  type LicenseStatusBody,
} from "@/lib/idp-license-client";

type AnyResult = AdminLicenseStatusResult | AdminUploadLicenseResult;

interface StatusPanelProps {
  body: LicenseStatusBody;
  context: "status" | "upload";
}

function StatusPanel({ body, context }: StatusPanelProps) {
  const tone =
    body.state === "license_valid"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : body.state === "license_missing"
        ? "border-stone-200 bg-stone-50 text-stone-700"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div
      className={`border rounded-xl px-4 py-3 text-sm ${tone}`}
      data-testid={context === "upload" ? "admin-license-upload-ok" : "admin-license-status-ok"}
    >
      <p className="font-semibold">
        State: <span className="font-mono">{body.state}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-stone-500">Distribution</dt>
        <dd>{body.distribution}</dd>
        <dt className="text-stone-500">Product</dt>
        <dd>{body.product}</dd>
        {body.tier && (
          <>
            <dt className="text-stone-500">Tier</dt>
            <dd>{body.tier}</dd>
          </>
        )}
        {body.licensee && (
          <>
            <dt className="text-stone-500">Licensee</dt>
            <dd>{body.licensee}</dd>
          </>
        )}
        {body.expiresAt && (
          <>
            <dt className="text-stone-500">Expires at</dt>
            <dd>
              <LocalTime value={body.expiresAt} fallback={body.expiresAt} />
            </dd>
          </>
        )}
        {body.licenseId && (
          <>
            <dt className="text-stone-500">License ID</dt>
            <dd className="font-mono">{body.licenseId}</dd>
          </>
        )}
        {body.licenseType && (
          <>
            <dt className="text-stone-500">License type</dt>
            <dd>{body.licenseType}</dd>
          </>
        )}
      </dl>
      {body.nextAction && <p className="mt-2 text-xs text-stone-600">{body.nextAction}</p>}
    </div>
  );
}

interface ErrorPanelProps {
  result: AnyResult;
  context: "status" | "upload";
}

function ErrorPanel({ result, context }: ErrorPanelProps) {
  if (result.kind === "ok") return null;
  let message: string;
  switch (result.kind) {
    case "unauthorized":
      message =
        "Admin authorization required. Paste a valid CE admin bearer token above and try again.";
      break;
    case "forbidden":
      message =
        "The supplied admin token does not carry the admin:license scope. Mint a token with admin:license (or admin:all) and retry.";
      break;
    case "rejected":
      message = result.message || `License rejected: ${result.code}`;
      break;
    case "unreachable":
      message = "The IDP is unreachable. Confirm the CE service is running and try again.";
      break;
    case "error":
      message = `Unexpected response (HTTP ${result.status}). Check the IDP logs.`;
      break;
  }
  return (
    <div
      className="border border-red-200 bg-red-50 rounded-xl px-4 py-3 text-sm text-red-900"
      data-testid={
        context === "upload" ? "admin-license-upload-error" : "admin-license-status-error"
      }
    >
      {message}
    </div>
  );
}

export function LicenseManager() {
  const [adminToken, setAdminToken] = useState("");
  const [license, setLicense] = useState("");
  const [statusResult, setStatusResult] = useState<AdminLicenseStatusResult | null>(null);
  const [uploadResult, setUploadResult] = useState<AdminUploadLicenseResult | null>(null);
  const [pendingStatus, setPendingStatus] = useState(false);
  const [pendingUpload, setPendingUpload] = useState(false);
  const [fileName, setFileName] = useState("");

  const onCheckStatus = useCallback(async () => {
    if (adminToken === "") return;
    setPendingStatus(true);
    setStatusResult(null);
    try {
      const res = await adminGetLicenseStatus(adminToken);
      setStatusResult(res);
    } finally {
      setPendingStatus(false);
    }
  }, [adminToken]);

  const onUpload = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (adminToken === "" || license === "") return;
      setPendingUpload(true);
      setUploadResult(null);
      try {
        const res = await adminUploadLicense({ adminToken, license });
        setUploadResult(res);
        // On success, drop the envelope from React state so the component
        // tree no longer holds it. The admin token stays so the operator
        // can re-check status without re-pasting; they can clear it
        // explicitly via the "Clear admin token" button.
        if (res.kind === "ok") {
          setLicense("");
          setFileName("");
        }
      } finally {
        setPendingUpload(false);
      }
    },
    [adminToken, license]
  );

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setLicense(text);
    setFileName(file.name);
  }, []);

  const clearAdminToken = useCallback(() => {
    setAdminToken("");
    setStatusResult(null);
  }, []);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold text-sky-950">Admin bearer token</span>
          <span className="block text-xs text-stone-500 mt-0.5">
            Issued by the operator via the CE admin tokens API. Carries the
            <code className="font-mono mx-1">admin:license</code> scope (or
            <code className="font-mono mx-1">admin:all</code>).
          </span>
          <input
            type="password"
            autoComplete="off"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ce-adm-…"
            className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-sky-500 focus:ring-sky-500"
            data-testid="admin-license-token-input"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCheckStatus}
            disabled={adminToken === "" || pendingStatus}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm disabled:bg-stone-300"
            data-testid="admin-license-check-status"
          >
            {pendingStatus ? "Checking…" : "Check license status"}
          </button>
          <button
            type="button"
            onClick={clearAdminToken}
            disabled={adminToken === ""}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:text-stone-400"
            data-testid="admin-license-clear-token"
          >
            Clear admin token
          </button>
        </div>
        {statusResult?.kind === "ok" && <StatusPanel body={statusResult.status} context="status" />}
        {statusResult && statusResult.kind !== "ok" && (
          <ErrorPanel result={statusResult} context="status" />
        )}
      </section>

      <form className="space-y-3 border-t border-stone-200 pt-5" onSubmit={onUpload}>
        <div>
          <label className="block">
            <span className="text-sm font-semibold text-sky-950">License envelope</span>
            <span className="block text-xs text-stone-500 mt-0.5">
              Paste the signed envelope text, or upload a <code className="font-mono">.lic</code>{" "}
              file. The envelope is held in memory only for the duration of the upload.
            </span>
            <textarea
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder='{"envelope":"…","signature":"…"}'
              rows={6}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-mono shadow-sm focus:border-sky-500 focus:ring-sky-500"
              data-testid="admin-license-envelope"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label
            htmlFor="admin-license-file-input"
            data-testid="admin-license-file-label"
            className="cursor-pointer rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Upload .lic file
          </label>
          <input
            id="admin-license-file-input"
            data-testid="admin-license-file-input"
            type="file"
            accept=".lic,application/json,text/plain"
            onChange={onFileChange}
            className="hidden"
          />
          {fileName && <span className="text-xs text-stone-500">Loaded: {fileName}</span>}
        </div>
        <button
          type="submit"
          disabled={adminToken === "" || license === "" || pendingUpload}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm disabled:bg-stone-300"
          data-testid="admin-license-upload"
        >
          {pendingUpload ? "Uploading…" : "Replace license"}
        </button>
        {uploadResult?.kind === "ok" && <StatusPanel body={uploadResult.status} context="upload" />}
        {uploadResult && uploadResult.kind !== "ok" && (
          <ErrorPanel result={uploadResult} context="upload" />
        )}
      </form>
    </div>
  );
}
