/**
 * Source-invariant tests for the shared Playwright login helpers.
 *
 * Scope: e2e/helpers/login.ts structural assertions.
 *
 * Split-runtime correctness:
 *   In a split-runtime deployment (identuum-idp-oss + identuum-ui running
 *   alongside identuum-ag), the UI root "/" redirects to /ag-admin/login,
 *   not to the IDP login page. IDP login helpers must navigate directly to
 *   "/login"; using "/" would silently land on the wrong login page.
 *
 * Tests run in the vitest node environment (no jsdom / browser). These are
 * source-file reads only — no credentials, cookies, or secrets are accessed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(import.meta.dirname, "../../");

function readHelper(relPath: string): string {
  return readFileSync(resolve(UI_ROOT, relPath), "utf-8");
}

const loginHelper = readHelper("e2e/helpers/login.ts");

// ── loginAsSiteAdmin ─────────────────────────────────────────────────────────

describe("loginAsSiteAdmin — IDP login routing", () => {
  // Locate the function body for targeted assertions.
  const fnStart = loginHelper.indexOf("export async function loginAsSiteAdmin");
  const fnEnd = loginHelper.indexOf("\nexport async function loginAsOrgAdmin");
  const fnBody = loginHelper.slice(fnStart, fnEnd);

  it("navigates to /login, not /", () => {
    expect(fnBody).toContain('goto("/login")');
  });

  it("does not use root '/' as the login entry point", () => {
    expect(fnBody).not.toContain('goto("/")');
  });

  it("does not call goto('/ag-admin/login') (IDP login ≠ AG login)", () => {
    // The string /ag-admin/login may appear in comments; check for goto() calls specifically.
    expect(fnBody).not.toContain('goto("/ag-admin/login")');
    expect(fnBody).not.toContain("goto('/ag-admin/login')");
  });

  it("fills the 'Email or domain' input (IDP login page element)", () => {
    expect(fnBody).toContain("Email or domain");
  });

  it("waits for /site-admin after successful TOTP", () => {
    expect(fnBody).toContain("/site-admin");
  });
});

// ── loginAsOrgAdmin ──────────────────────────────────────────────────────────

describe("loginAsOrgAdmin — IDP login routing", () => {
  const fnStart = loginHelper.indexOf("export async function loginAsOrgAdmin");
  const fnEnd = loginHelper.indexOf("\n// ── Internal helpers");
  const fnBody = loginHelper.slice(fnStart, fnEnd);

  it("navigates to /login, not /", () => {
    expect(fnBody).toContain('goto("/login")');
  });

  it("does not use root '/' as the login entry point", () => {
    expect(fnBody).not.toContain('goto("/")');
  });

  it("does not call goto('/ag-admin/login') (IDP login ≠ AG login)", () => {
    // The string /ag-admin/login may appear in comments; check for goto() calls specifically.
    expect(fnBody).not.toContain('goto("/ag-admin/login")');
    expect(fnBody).not.toContain("goto('/ag-admin/login')");
  });

  it("fills the 'Email or domain' input (IDP login page element)", () => {
    expect(fnBody).toContain("Email or domain");
  });

  it("waits for /org-admin after successful login", () => {
    expect(fnBody).toContain("/org-admin");
  });
});

// ── Module-wide negative invariants ─────────────────────────────────────────

describe("login helper module — no root '/' login entry points", () => {
  it("no goto('/') call exists anywhere in the helper", () => {
    // Any goto("/") in the helper is a split-runtime routing bug:
    // "/" may redirect to /ag-admin/login in deployments that include AG.
    expect(loginHelper).not.toContain('goto("/")');
  });

  it("does not hardcode localhost URLs", () => {
    expect(loginHelper).not.toMatch(/https?:\/\/localhost/i);
    expect(loginHelper).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("does not print credentials, cookies, or session tokens", () => {
    const forbidden = [
      "console.log",
      "console.error",
      "eyJhbGciO",
      "client_secret",
      "password_hash",
    ];
    for (const term of forbidden) {
      expect(loginHelper).not.toContain(term);
    }
  });
});

// ── AG login uses /ag-admin/login (separate flow) ────────────────────────────

describe("AG admin login — uses separate /ag-admin/login route", () => {
  it("ag-admin/(authed)/layout.tsx redirects to /ag-admin/login on no session", () => {
    const layout = readHelper("src/app/ag-admin/(authed)/layout.tsx");
    expect(layout).toContain("/ag-admin/login");
  });

  it("login helper module does not contain an AG operator login helper", () => {
    // AG operator login is handled by the /ag-admin/login page directly;
    // it does NOT use the shared loginAsSiteAdmin / loginAsOrgAdmin helpers.
    expect(loginHelper).not.toContain("ag_operator_session");
    expect(loginHelper).not.toContain("/api/ag/login");
  });
});
