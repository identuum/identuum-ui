/**
 * End-to-end M2 license-envelope upload UI coverage for the CE
 * customer-smoke (or any prepared CE) stack, added by
 * `agent-a-20260620-idp-ui-ce-license-upload-playwright` to close
 * the final CE-MATRIX M2 browser-UI gap noted in
 * `identuum-idp-ce/docs/CE_MANUAL_TEST_MATRIX.md`.
 *
 * Surface chosen: `/site-admin/license` `LicenseManager` (post-
 * `setup_complete` admin-bearer-token-gated replace flow). The
 * setup-wizard's license step is the OTHER M2 surface, but it is
 * one-shot (consuming the single-use setup token), single-run-per-
 * stack-lifetime, and covered structurally by the prior
 * `ce-setup-wizard.spec.ts` slice's pre-flight gate B (which verifies
 * the wizard correctly defers when the license is already valid).
 * The admin-bearer-token replace flow at `/site-admin/license` is
 * RE-RUNNABLE (operators can replace a valid license with another
 * valid envelope multiple times), so it's the natural target for
 * routine UI regression coverage.
 *
 * What this spec asserts.
 *   1. Pre-flight: `GET ${IDP}/api/setup/license` returns
 *      `state=license_valid` AND `distribution=ce` (otherwise the
 *      spec skips — the stack is not licensed yet OR not a CE
 *      backend).
 *   2. Logs in as site_admin (MFA-optional helper — works against
 *      both customer-smoke M1 and dev-stack admins).
 *   3. Navigates to `/site-admin/license`. Asserts the read-only
 *      status card renders "Valid" (added by the prior
 *      `agent-a-20260620-idp-ui-site-admin-license-readonly-view`
 *      slice).
 *   4. Pastes the admin bearer token (operator env). Clicks "Check
 *      license status". Asserts the bearer-authed status panel
 *      renders `state=license_valid`.
 *   5. Pastes the license envelope (read from operator-supplied
 *      file path OR direct env). Clicks "Replace license". Asserts
 *      the upload success panel renders with `state=license_valid`.
 *   6. Backend re-check: `GET ${IDP}/api/setup/license` AND
 *      `GET ${IDP}/api/v1/component` both still report valid +
 *      agree (invariant #12).
 *   7. UI re-check: reload `/site-admin/license`; the read-only
 *      card still reads "Valid".
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_CE_LICENSE_UPLOAD=1` → run the replace ceremony.
 *
 * Why env-gated and operator-supplied.
 *   - The replace flow mutates server state (writes a new envelope
 *     row to the IDP's license table). The spec is re-runnable
 *     because replacing a valid license with another valid envelope
 *     stays in the `license_valid` state, but it IS a real wire-
 *     level state change.
 *   - The admin bearer token + license envelope are operator
 *     secrets. They live ONLY in the operator's local env (or in a
 *     file at a path supplied via env) and are NEVER persisted in
 *     this spec.
 *
 * Operator env vars (NEVER printed by this spec).
 *   - `IDENTUUM_E2E_CE_LICENSE_UPLOAD` — gate (default: skip).
 *   - `IDP_BASE_URL` — IDP backend URL (default
 *     `http://127.0.0.1:7123`).
 *   - `IDENTUUM_E2E_BASE_URL` — UI baseURL (default
 *     `http://127.0.0.1:7124`).
 *   - `IDENTUUM_CE_ADMIN_TOKEN` — bearer admin token carrying the
 *     `admin:license` scope (or `admin:all`). Issued by the
 *     operator via the CE admin tokens API.
 *   - `IDENTUUM_CE_LICENSE_ENVELOPE_FILE` — path to a local file
 *     containing the JSON envelope text (preferred). Mutually
 *     exclusive with the env-text variant.
 *   - `IDENTUUM_CE_LICENSE_ENVELOPE_TEXT` — direct envelope text
 *     (alternative; avoid storing large blobs in shell env).
 *
 * Secret-safety contract.
 *   - Admin bearer token + envelope text are fed directly to
 *     `page.locator(...).fill(value)`. Playwright does NOT log
 *     `fill()` values.
 *   - Envelope file (when used) is read via `fs.readFileSync` then
 *     immediately filled — the buffer is not echoed, printed,
 *     decoded, or snapshotted.
 *   - The status panels' DOM contains licensee/expiresAt/license_id
 *     fields after admin auth (operator-controlled disclosure on
 *     the page itself). This spec ONLY asserts the state badge
 *     reads `license_valid`; it NEVER reads the wider field values.
 *   - On-failure diagnostic prints ONLY public URLs + visible page
 *     heading text — no env values, no cookies, no envelope bytes.
 *   - The license envelope file path is logged ONLY via the test
 *     name (which doesn't reference the path); the spec never
 *     prints the path string itself.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { loginAsSiteAdminMFAOptional } from "./helpers/login";

const UPLOAD_ENABLED = process.env.IDENTUUM_E2E_CE_LICENSE_UPLOAD === "1";
const IDP_BASE_URL = process.env.IDP_BASE_URL ?? "http://127.0.0.1:7123";

function loadEnvelopeText(): string {
  const fileEnv = process.env.IDENTUUM_CE_LICENSE_ENVELOPE_FILE ?? "";
  if (fileEnv !== "") {
    return readFileSync(fileEnv, "utf8");
  }
  return process.env.IDENTUUM_CE_LICENSE_ENVELOPE_TEXT ?? "";
}

test.describe("/site-admin/license — admin-bearer-token replace flow", () => {
  test.skip(
    !UPLOAD_ENABLED,
    "IDENTUUM_E2E_CE_LICENSE_UPLOAD is not 1 — skipping the destructive admin license replace ceremony. " +
      "This spec mutates server state by writing a new envelope row. Run it standalone against a " +
      "prepared CE stack with an operator-supplied admin bearer token + license envelope file."
  );

  test("read-only Valid → admin token check → replace → backend + UI re-confirm Valid", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const adminToken = process.env.IDENTUUM_CE_ADMIN_TOKEN ?? "";
    const envelopeText = loadEnvelopeText();
    if (adminToken === "" || envelopeText === "") {
      test.skip(
        true,
        "Operator env vars missing: IDENTUUM_CE_ADMIN_TOKEN AND (IDENTUUM_CE_LICENSE_ENVELOPE_FILE OR IDENTUUM_CE_LICENSE_ENVELOPE_TEXT) must be set. Values NEVER printed."
      );
      return;
    }

    // Pre-flight: backend must be reachable and currently licensed.
    const licBefore = await request.get(`${IDP_BASE_URL}/api/setup/license`);
    expect(
      licBefore.status(),
      `IDP at ${IDP_BASE_URL} did not respond to /api/setup/license — check the stack is up`
    ).toBe(200);
    const licBeforeBody = (await licBefore.json()) as { state?: string; distribution?: string };
    if (licBeforeBody.distribution !== "ce") {
      test.skip(
        true,
        `IDP at ${IDP_BASE_URL} reports distribution=${String(licBeforeBody.distribution)} — this spec only covers CE backends.`
      );
      return;
    }
    if (licBeforeBody.state !== "license_valid") {
      test.skip(
        true,
        `CE backend at ${IDP_BASE_URL} reports license state=${String(licBeforeBody.state)} — the replace flow requires a pre-existing valid license (run M2 setup first).`
      );
      return;
    }

    // Login as site_admin (MFA-optional helper — works against
    // customer-smoke M1 site_admin whether or not TOTP is enrolled).
    await loginAsSiteAdminMFAOptional(page);

    // Step 1: read-only status renders Valid (proves the cookie
    // session reaches the read-only server-side probe; same hook
    // that the customer-smoke Group 2 test asserts).
    await page.goto("/site-admin/license");
    await expect(page.getByRole("heading", { name: "License", level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("readonly-license-status-card")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("readonly-license-status-badge")).toHaveText(/Valid/, {
      timeout: 10_000,
    });

    // Step 2: paste admin bearer token, click "Check license status".
    // The wider field set (licensee/expiresAt/licenseId) renders in
    // the admin-status panel; we only assert state=license_valid.
    await page.getByTestId("admin-license-token-input").fill(adminToken);
    await page.getByTestId("admin-license-check-status").click();
    await expect(
      page.getByTestId("admin-license-status-ok"),
      "admin-status panel must render after a valid admin bearer token check"
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("admin-license-status-ok")).toContainText(/license_valid/i, {
      timeout: 5_000,
    });

    // Step 3: paste the envelope and click "Replace license".
    await page.getByTestId("admin-license-envelope").fill(envelopeText);
    await page.getByTestId("admin-license-upload").click();
    await expect(
      page.getByTestId("admin-license-upload-ok"),
      "admin-upload-ok panel must render after a successful replace"
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("admin-license-upload-ok")).toContainText(/license_valid/i, {
      timeout: 5_000,
    });

    // Step 4: backend re-check — both endpoints still agree (invariant #12).
    const licAfter = await request.get(`${IDP_BASE_URL}/api/setup/license`);
    expect(licAfter.status()).toBe(200);
    const licAfterBody = (await licAfter.json()) as { state?: string };
    expect(licAfterBody.state, "/api/setup/license must remain license_valid after replace").toBe(
      "license_valid"
    );
    const compAfter = await request.get(`${IDP_BASE_URL}/api/v1/component`);
    expect(compAfter.status()).toBe(200);
    const compAfterBody = (await compAfter.json()) as { license?: { status?: string } };
    expect(
      compAfterBody.license?.status,
      "/api/v1/component license.status must be valid after replace (invariant #12)"
    ).toBe("valid");

    // Step 5: UI re-check — reload the page; read-only card still Valid.
    await page.goto("/site-admin/license");
    await expect(page.getByTestId("readonly-license-status-badge")).toHaveText(/Valid/, {
      timeout: 10_000,
    });
  });
});
