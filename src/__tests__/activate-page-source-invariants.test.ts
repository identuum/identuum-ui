/**
 * activate-page-source-invariants.test.ts — ACTIVATE-PAGE-1
 *
 * THE-DEAD-ACTIVATE-LINK (2026-08-27): the IdP's activation email links
 * to <linkBaseURL>/activate?token=... (smtp_notifier.go) and no UI route
 * served it — the pending org_admin's emailed link 404'd, the last mile
 * of the create-with-admin_email flow. The /activate page is that mile.
 * The whole chain was proven live against a HEAD backend before arming:
 * create → token → validate → consume (org active, reuse refused) →
 * admin login (pending session ON HTTP 401) → MFA enrolled → session
 * minted → authenticated call 200.
 *
 * These pins hold the ceremony's wire contract and its secret handling:
 *   1. validate hits GET /api/v1/auth/organizations/activate/:token.
 *   2. consume POSTs /api/v1/auth/organizations/activate {token, password}.
 *   3. the post-activation probe accepts the MEASURED 401-with-session
 *      shape (a fresh admin's enrollment-required login is a 401 —
 *      requiring res.ok would silently drop the MFA chaining).
 *   4. the token never touches client storage.
 *
 * Source-invariant style (no React render, no network).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const actions = (): string => readFileSync(resolve(ROOT, "app/activate/actions.ts"), "utf8");
const clientSrc = (): string => readFileSync(resolve(ROOT, "app/activate/form-client.tsx"), "utf8");
const pageSrc = (): string => readFileSync(resolve(ROOT, "app/activate/page.tsx"), "utf8");

describe("/activate — the emailed activation link lands on a real ceremony", () => {
  it("validates and consumes on the mounted activation endpoints [ACTIVATE-PAGE-1]", () => {
    const src = actions();
    expect(src, "validate must hit the mounted GET route with the token path-encoded").toMatch(
      /\/api\/v1\/auth\/organizations\/activate\/\$\{encodeURIComponent\(rawToken\)\}/
    );
    expect(src, "consume must POST the mounted activate route").toMatch(
      /\/api\/v1\/auth\/organizations\/activate`/
    );
    expect(src, "consume carries exactly token + password").toMatch(
      /JSON\.stringify\(\{\s*token:\s*parsed\.data\.token,\s*password:\s*parsed\.data\.password\s*\}\)/
    );
  });

  it("the post-activation probe accepts the measured 401 pending-session shape", () => {
    const src = actions();
    expect(
      src,
      "a fresh admin's enrollment-required login is HTTP 401 with session_id — refusing non-ok responses would silently drop the MFA chaining"
    ).toMatch(/if\s*\(!res\.ok\s*&&\s*res\.status\s*!==\s*401\)\s*return\s*""/);
    expect(src, "the pending session requires the mfa_required signal").toMatch(
      /body\?\.mfa_required\s*===\s*true/
    );
  });

  it("the token stays server-side and out of client storage", () => {
    for (const [name, src] of [
      ["actions", actions()],
      ["form-client", clientSrc()],
      ["page", pageSrc()],
    ] as const) {
      expect(src, `${name} must not touch localStorage`).not.toMatch(/localStorage/);
      expect(src, `${name} must not touch sessionStorage`).not.toMatch(/sessionStorage/);
    }
    expect(pageSrc(), "the page reads ?token once from searchParams").toMatch(/params\.token/);
  });
});
