/**
 * Tests for the new /org-admin/applications surface.
 *
 * This slice replaced the "Coming soon" Applications placeholder
 * with a read-only OAuth clients list backed by GET /api/v1/clients
 * (org-scoped by the IDP's RoleOrgAdmin filter in
 * ClientService.ListClients).
 *
 * Coverage:
 *   - The new `OrgClientItem` type is operator-safe: NO client_secret,
 *     NO private_key, NO signing material, NO inline JWKS keys, NO
 *     token / cookie / session substrings.
 *   - The wire client `listOwnOrganizationClients` calls GET
 *     /api/v1/clients, never sends an org_id query param (tenant
 *     scope is server-enforced), and the sanitiser explicitly drops
 *     `client_secret` even if a future regression on the IDP side
 *     started populating it on the list path.
 *   - The new page source is read-only — no `useActionState`, no
 *     `<form>`, no `client_secret` reference, no `regenerate` action.
 *   - The sidebar Applications item is now an active link (not
 *     `DISABLED_LABELS`).
 *   - The Overview Applications card href is `/org-admin/applications`.
 *   - The route is behind the /org-admin layout guard (no
 *     client-side-only auth check, no `"use client"` directive on
 *     the page itself).
 *
 * The IDP-side tenant scope is covered by IDP Go tests. The UI side
 * pin here is the no-secret / no-token contract on the wire shape
 * and on the rendered surface.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ADMIN_OVERVIEW_CARDS } from "../app/org-admin/page";
import type { OrgClientItem } from "../lib/types";

// ── Type shape ─────────────────────────────────────────────────────────────

describe("OrgClientItem — operator-safe wire shape", () => {
  // Compile-time pin: a minimal OrgClientItem literal must satisfy
  // the type without `client_secret` / `private_key` / `jwks` keys.
  // The TS compiler would reject any of those as excess properties.
  it("compiles with the documented operator-safe field set only", () => {
    const item: OrgClientItem = {
      id: "00000000-0000-0000-0000-000000000001",
      client_id: "test-client",
      name: "Test Client",
      is_public: false,
      skip_consent: false,
      redirect_uris: ["https://example.com/cb"],
      post_logout_redirect_uris: [],
      allowed_audiences: [],
      scope: "openid profile",
      token_endpoint_auth_method: "client_secret_post",
      jwks_uri: "",
      token_endpoint_auth_signing_alg: "",
      organization_id: "00000000-0000-0000-0000-000000000002",
      created_at: "2026-05-30T00:00:00Z",
    };
    expect(item.client_id).toBe("test-client");
    // Defensive runtime confirmation that no secret-shaped key
    // accidentally survived the type sanitiser.
    const keys = Object.keys(item);
    expect(keys).not.toContain("client_secret");
    expect(keys).not.toContain("private_key");
    expect(keys).not.toContain("jwks");
    expect(keys).not.toContain("signing_key");
    expect(keys).not.toContain("refresh_token");
    expect(keys).not.toContain("access_token");
  });
});

describe("types.ts — OrgClientItem source contract", () => {
  const TYPES_SRC = readFileSync(resolve(__dirname, "..", "lib", "types.ts"), "utf-8");

  it("declares OrgClientItem and OrgClientListResult exports", () => {
    expect(TYPES_SRC).toMatch(/export interface OrgClientItem\b/);
    expect(TYPES_SRC).toMatch(/export interface OrgClientListResult\b/);
  });

  it("OrgClientItem does NOT declare any secret/key/token field", () => {
    const start = TYPES_SRC.indexOf("export interface OrgClientItem");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = TYPES_SRC.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    // Strip JSDoc + line comments inside the interface so a doc
    // line that legitimately names a forbidden field (as a
    // documented exclusion) does not trip the assertion. Real
    // field declarations survive the strip.
    const block = TYPES_SRC.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret\b/,
      /\bprivate_key\b/,
      /\bsigning_key\b/,
      /\binline_jwks\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauth_code\b/,
      /\bauthorization_code\b/,
      /\bSet-Cookie\b/,
      /\bBearer\b/,
    ];
    for (const pat of BANNED) {
      expect(block, `OrgClientItem must not declare a field matching ${pat}`).not.toMatch(pat);
    }
  });
});

// ── idp-admin-client source contract ───────────────────────────────────────

describe("idp-admin-client.ts — listOwnOrganizationClients source contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the function with the documented name", () => {
    expect(SRC).toMatch(/export async function listOwnOrganizationClients\b/);
  });

  it("calls GET /api/v1/clients (tenant scope server-enforced — never sends organization_id)", () => {
    expect(SRC).toMatch(/\/api\/v1\/clients\?\$\{params\.toString\(\)\}/);
    // Isolate the helper body and assert the URL construction does
    // NOT include an organization_id query param. The IDP's
    // ClientService.ListClients enforces tenant scope from the actor
    // role; a UI-side organization_id would either be ignored (best
    // case) or a regression hint to widen scope (bad).
    const fnStart = SRC.indexOf("export async function listOwnOrganizationClients");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    // Strip comments inside the helper body so the JSDoc that
    // documents tenant scoping (and legitimately names
    // organization_id as a forbidden URL param) doesn't trip the
    // assertion. The OrgClientItem sanitiser also reads the field
    // from the wire envelope for operator display — that is also
    // a legitimate use. The only forbidden use is appending it as
    // a query param on the OUTGOING request URL.
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Specifically: params.set("organization_id", ...) and
    // params.append("organization_id", ...) MUST be absent.
    expect(body).not.toMatch(/params\.(set|append)\(\s*["']organization_id["']/);
    // Defensive: building the URL with an interpolated organization_id
    // suffix would also surface here.
    expect(body).not.toMatch(/\/clients\?[^`]*organization_id=/);
  });

  it("sanitiser NEVER reads client_secret / private_key / signing material from the wire", () => {
    const fnStart = SRC.indexOf("export async function listOwnOrganizationClients");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    // Strip JSDoc comments inside the function body before scanning.
    const noComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const BANNED: RegExp[] = [
      /c\.client_secret/,
      /c\.private_key/,
      /c\.signing_key/,
      /c\.refresh_token/,
      /c\.access_token/,
      /c\.auth_code/,
      /c\.jwks(?!_uri\b)/,
    ];
    for (const pat of BANNED) {
      expect(noComments).not.toMatch(pat);
    }
  });
});

// ── Page source contract ────────────────────────────────────────────────────

describe("/org-admin/applications/page.tsx — read-only surface", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "page.tsx"),
    "utf-8"
  );

  it("calls listOwnOrganizationClients (the org-scoped wire helper)", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*listOwnOrganizationClients\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/await\s+listOwnOrganizationClients\(\)/);
  });

  it("declares an operator heading + within-org subtitle", () => {
    expect(SRC).toMatch(/<h1[^>]*>Applications<\/h1>/);
    expect(SRC).toMatch(/your organization/i);
    expect(SRC).toMatch(/Read-only/);
  });

  it("renders empty + error panels", () => {
    expect(SRC).toMatch(/function EmptyPanel\(/);
    expect(SRC).toMatch(/function ErrorPanel\(/);
    expect(SRC).toMatch(/No applications yet/);
    expect(SRC).toMatch(/Could not load applications/);
  });

  it("uses oauth_clients capability facts for backend-not-exposed page copy without hiding links", () => {
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "oauth_clients"');
    expect(SRC).toContain(
      "const result = capabilityBoundary ? null : await listOwnOrganizationClients();"
    );
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC).toMatch(/href="\/org-admin\/applications\/new"[\s\S]*?Create application/);
    expect(SRC).toMatch(
      /href=\{\s*`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}`\s*\}/
    );
  });

  it("is server-rendered (no 'use client', no client-side auth check)", () => {
    expect(SRC).not.toMatch(/^"use client";/m);
    expect(SRC).not.toMatch(/getServerSession\(/);
    expect(SRC).not.toMatch(/useActionState/);
  });

  it("does NOT render any secret / key / token / mutation affordance", () => {
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bprivate_key\b/,
      /\bsigning_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauth_code\b/,
      /\bauthorization_code\b/,
      /\bRegenerate\b/i,
      /\bRotate\b/i,
      /<form/,
      /method="POST"/i,
      /method="DELETE"/i,
      /method="PATCH"/i,
      /method="PUT"/i,
    ];
    // Strip JSDoc + comments first so the "no client_secret display"
    // documentation block does not trip the assertion.
    const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pat of BANNED) {
      expect(noComments, `page must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("does NOT render raw audit metadata or JSON.stringify the client envelope", () => {
    // Strip JSDoc + line comments before scanning so the page's
    // header doc-block (which legitimately names "metadata" as a
    // forbidden render target) doesn't trip the assertion. Real
    // code that read e.metadata would survive the strip.
    const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/JSON\.stringify\(/);
    // The lowercase "metadata" identifier IS legitimately used by
    // Next.js: `export const metadata: Metadata = { title: ... }`
    // — that's the page's static metadata convention, not an
    // audit-row metadata leak. Pin the actual leakage shape: a
    // direct read of client.metadata or e.metadata that would
    // render an arbitrary backend JSON blob.
    expect(noComments).not.toMatch(/\bclient\.metadata\b/);
    expect(noComments).not.toMatch(/\be\.metadata\b/);
    expect(noComments).not.toMatch(/\.metadata\s*\}/);
  });
});

// ── Sidebar Applications promoted from disabled to active link ─────────────

describe("OrgAdminNav — Applications is now an active link", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "org-admin-nav.tsx"),
    "utf-8"
  );

  it("DISABLED_LABELS no longer contains 'Applications'", () => {
    // The previous shape was `const DISABLED_LABELS = ["Applications"];`.
    // A regression that re-introduced it would surface here.
    expect(SRC).not.toMatch(/DISABLED_LABELS\s*=\s*\[\s*"Applications"/);
    // Belt-and-suspenders: the disabled-list literal exists (still)
    // but must be empty OR a non-Applications entry. Future
    // disabled items would re-populate it.
    expect(SRC).toMatch(/DISABLED_LABELS[^=]*=/);
  });

  it("NAV_LINKS includes a real /org-admin/applications entry", () => {
    expect(SRC).toMatch(
      /label:\s*"Applications"[\s\S]*?href:\s*"\/org-admin\/applications"[\s\S]*?capability:\s*"oauth_clients"/
    );
  });
});

// ── Overview Applications card promoted from placeholder to active ─────────

describe("ORG_ADMIN_OVERVIEW_CARDS — Applications card is active", () => {
  it("the Applications card now carries href = /org-admin/applications", () => {
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Applications");
    expect(card).toBeDefined();
    expect(card?.href).toBe("/org-admin/applications");
  });

  it("the Applications card description no longer mentions 'Coming soon'", () => {
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Applications");
    expect(card?.description).not.toMatch(/coming soon/i);
  });
});

// ── Create Application flow ────────────────────────────────────────────────
//
// The new /org-admin/applications/new surface lets an org_admin
// register a new OAuth client and receive the IDP-generated
// client_secret EXACTLY ONCE via the in-memory server-action
// envelope. Tests below pin the source-text contract for:
//   - the wire helper (createOrganizationClient) — never sends
//     organization_id; sanitises the response;
//   - the server action (createApplicationAction) — re-validates
//     session + org_admin role; rejects unsafe redirect URIs;
//     surfaces client_secret only on success;
//   - the client form — uses useActionState; renders the secret
//     ONLY when state.phase === "success"; never imports a storage
//     primitive (localStorage / sessionStorage / cookies);
//   - the list page — has a Create application link to /new.

describe("idp-admin-client.createOrganizationClient — wire contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the exported function", () => {
    expect(SRC).toMatch(/export async function createOrganizationClient\b/);
  });

  it("POSTs to /api/v1/clients", () => {
    expect(SRC).toMatch(
      /createOrganizationClient[\s\S]*?\/api\/v1\/clients[\s\S]*?method:\s*"POST"/
    );
  });

  it("NEVER includes organization_id in the OUTGOING request body", () => {
    const fnStart = SRC.indexOf("export async function createOrganizationClient");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The OUTGOING body literal must not assign organization_id.
    // Isolate the request-body construction block (everything
    // between `const body: Record<...> =` and the closing `}`)
    // and assert organization_id never appears there. The
    // sanitiser RESPONSE projection at the bottom of the function
    // does legitimately read `d.organization_id` and copy it to
    // the returned CreatedOrgClient — that's not a leak, that's
    // the operator-visible org id from the IDP's response.
    const bodyDeclMatch = body.match(/const\s+body:[\s\S]*?\n\s{2}\}/);
    expect(bodyDeclMatch).not.toBeNull();
    const bodyDecl = bodyDeclMatch?.[0] ?? "";
    expect(bodyDecl).not.toMatch(/organization_id/);
    // Belt-and-suspenders: no body.organization_id assignment anywhere.
    expect(body).not.toMatch(/body\.organization_id\s*=/);
  });

  it("surfaces client_secret from the IDP response onto the returned envelope", () => {
    // The wire helper MUST carry client_secret through to the
    // caller's CreatedOrgClient so the server action can hand it
    // to the form's single-shot state.
    expect(SRC).toMatch(/client_secret:\s*typeof\s+d\.client_secret\s*===\s*"string"/);
  });

  it("does NOT log client_secret / any token-shaped substring", () => {
    const fnStart = SRC.indexOf("export async function createOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});

describe("createApplicationAction — server-action contract", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "actions.ts"),
    "utf-8"
  );

  it("re-validates session and the org_admin role", () => {
    expect(SRC).toMatch(/getServerSession\(\)/);
    expect(SRC).toMatch(/role\s*!==\s*"org_admin"/);
    // session-expired redirect on missing session.
    expect(SRC).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
  });

  it("does NOT read organization_id from the form data", () => {
    expect(SRC).not.toMatch(/formData\.get\(\s*["']organization_id["']\s*\)/);
    expect(SRC).not.toMatch(/formData\.get\(\s*["']org_id["']\s*\)/);
  });

  it("rejects unsafe redirect URI schemes (javascript: / data: / file: / vbscript:)", () => {
    // The isSafeRedirectURI helper's negative-scheme regex.
    expect(SRC).toMatch(/javascript\|data\|file\|vbscript/);
    // Each redirect URI must pass the safety check before the wire call.
    expect(SRC).toMatch(/isSafeRedirectURI\(uri\)/);
  });

  it("rejects empty redirect URI list", () => {
    expect(SRC).toMatch(/redirectURIs\.length\s*===\s*0/);
  });

  it("NEVER logs the client_secret or any other returned credential field", () => {
    // No console.* calls anywhere in the action.
    expect(SRC).not.toMatch(/console\.\w+/);
    // The success state's client_secret is sourced ONLY from the
    // wire helper's response (`result.data.client_secret`) and
    // not constructed locally.
    expect(SRC).toMatch(/client_secret:\s*result\.data\.client_secret/);
  });

  it("revalidatePath fires ONLY on success", () => {
    // Find the success branch and the revalidate call.
    const successBranchMatch = SRC.match(/if\s*\(result\.ok\)\s*\{[\s\S]*?return\s*\{/);
    expect(successBranchMatch).not.toBeNull();
    const successBlock = successBranchMatch?.[0] ?? "";
    expect(successBlock).toMatch(/revalidatePath\("\/org-admin\/applications"\)/);
    // The error branches MUST NOT call revalidatePath.
    const errorBlocks = SRC.split("if (result.ok)")[1] ?? "";
    const afterSuccess = errorBlocks.split("if (result.conflict)")[1] ?? "";
    expect(afterSuccess).not.toMatch(/revalidatePath/);
  });
});

describe("CreateApplicationForm — single-shot client_secret rendering", () => {
  const FORM_SRC = readFileSync(
    resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "applications",
      "new",
      "create-application-form.tsx"
    ),
    "utf-8"
  );
  // Strip JSDoc + line comments before negative-substring scans so
  // doc-block mentions of "localStorage", "console.log", etc. (as
  // documented exclusions) don't trip the assertions. Real code that
  // referenced them would survive the strip.
  const FORM_SRC_NO_COMMENTS = FORM_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  it("is a 'use client' component using useActionState", () => {
    expect(FORM_SRC).toMatch(/^"use client";/);
    expect(FORM_SRC).toMatch(/useActionState\(createApplicationAction/);
  });

  it("renders client_secret ONLY inside the SuccessPanel branch (gated by state.phase === 'success')", () => {
    // The Form vs SuccessPanel branch is gated at the top of the
    // component. Pin the gate shape (allow whitespace + JSX paren).
    expect(FORM_SRC).toMatch(/state\.phase\s*===\s*"success"\s*\?\s*\(\s*<SuccessPanel/);
    // The string `created.client_secret` must appear ONLY inside
    // the SuccessPanel function — never in Form or elsewhere. A
    // simple shape pin: count occurrences and require them to be
    // bounded.
    const matches = FORM_SRC_NO_COMMENTS.match(/created\.client_secret/g) ?? [];
    // Two references: the hasSecret check + the <dd> rendering. A
    // third would mean the secret is leaking into a non-success
    // branch.
    expect(matches.length).toBeLessThanOrEqual(2);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("never writes any value to localStorage / sessionStorage / cookies", () => {
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/localStorage/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/document\.cookie/);
  });

  it("never logs anything via console.*", () => {
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });

  it("renders the copy-once warning copy in the SuccessPanel", () => {
    expect(FORM_SRC).toMatch(/will not be shown again/i);
    expect(FORM_SRC).toMatch(/Copy this secret now/i);
  });

  it("does NOT mirror the secret into URL / search params / browser history", () => {
    expect(FORM_SRC).not.toMatch(/window\.history/);
    expect(FORM_SRC).not.toMatch(/searchParams/);
    expect(FORM_SRC).not.toMatch(/router\.push\([^)]*client_secret/);
  });
});

describe("/org-admin/applications list page — Create application link + no secret render", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "page.tsx"),
    "utf-8"
  );

  it("links to /org-admin/applications/new", () => {
    expect(SRC).toMatch(/href="\/org-admin\/applications\/new"[\s\S]*?Create application/);
  });

  it("list page never renders client_secret", () => {
    // Strip comments to avoid catching the doc-block exclusion.
    const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/\bclient_secret\b/);
    expect(noComments).not.toMatch(/\bprivate_key\b/);
    expect(noComments).not.toMatch(/\baccess_token\b/);
    expect(noComments).not.toMatch(/\brefresh_token\b/);
    expect(noComments).not.toMatch(/\bsigning_key\b/);
    expect(noComments).not.toMatch(/\bauthorization_code\b/);
  });
});

describe("/org-admin/applications/new page — server-rendered shell", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "new", "page.tsx"),
    "utf-8"
  );

  it("is server-rendered (no 'use client', no client-side auth check)", () => {
    expect(SRC).not.toMatch(/^"use client";/m);
    expect(SRC).not.toMatch(/getServerSession\(/);
  });

  it("hosts the CreateApplicationForm", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*CreateApplicationForm\s*\}\s*from\s+["']\.\/create-application-form["']/
    );
    expect(SRC).toMatch(/<CreateApplicationForm\s*\/>/);
  });

  it("uses oauth_clients capability facts for backend-not-exposed copy while preserving unknown fallback", () => {
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "oauth_clients"');
    expect(SRC).toContain("capabilityBoundary ? (");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC).toContain("<CreateApplicationForm />");
  });

  it("page heading + subtitle mention the single-shot secret contract", () => {
    // The JSX may format the h1 content across multiple lines —
    // allow any whitespace between the open and close tags.
    expect(SRC).toMatch(/<h1[^>]*>\s*Create application\s*<\/h1>/);
    expect(SRC).toMatch(/shown\s+only\s+once/i);
  });

  it("does NOT render any secret/key/token field directly on the page", () => {
    const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/\bclient_secret\b/);
    expect(noComments).not.toMatch(/\bprivate_key\b/);
    expect(noComments).not.toMatch(/\baccess_token\b/);
    expect(noComments).not.toMatch(/\brefresh_token\b/);
  });
});

// ── Application detail (read-only) ─────────────────────────────────────────
//
// The new /org-admin/applications/[id] page is the read-only detail
// surface backed by GET /api/v1/clients/:id. The IDP enforces tenant
// scope: org_admin requesting another org's client returns 403. The
// handler does not populate client_secret on the get-by-id response;
// the wire helper defensively drops the field anyway.

describe("idp-admin-client.getOrganizationClientById — wire contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the exported function", () => {
    expect(SRC).toMatch(/export async function getOrganizationClientById\b/);
  });

  it("GETs /api/v1/clients/:id with the id URL-encoded", () => {
    expect(SRC).toMatch(
      /getOrganizationClientById[\s\S]*?\/api\/v1\/clients\/\$\{encodeURIComponent\(id\)\}[\s\S]*?method:\s*"GET"/
    );
  });

  it("maps 400 → invalid, 403 → forbidden, 404 → notFound, other non-2xx → generic", () => {
    // Pin the discriminated-error mapping the page renders.
    const fnStart = SRC.indexOf("export async function getOrganizationClientById");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).toMatch(/res\.status\s*===\s*400[\s\S]*?invalid:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*403[\s\S]*?forbidden:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*404[\s\S]*?notFound:\s*true/);
  });

  it("sanitiser NEVER reads client_secret / private_key / inline jwks from the response", () => {
    // Comment-strip so the JSDoc that names these fields as
    // documented exclusions doesn't trip the assertion. Real code
    // referencing the fields would survive the strip.
    const fnStart = SRC.indexOf("export async function getOrganizationClientById");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The c.<field> reads the sanitiser performs MUST NOT include
    // any secret-shaped field. (c.jwks_uri is allowed; c.jwks
    // alone — inline key material — is NOT.)
    expect(body).not.toMatch(/c\.client_secret/);
    expect(body).not.toMatch(/c\.private_key/);
    expect(body).not.toMatch(/c\.signing_key/);
    expect(body).not.toMatch(/c\.access_token/);
    expect(body).not.toMatch(/c\.refresh_token/);
    expect(body).not.toMatch(/c\.jwks(?!_uri\b)/);
  });

  it("does NOT log anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function getOrganizationClientById");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});

describe("/org-admin/applications/[id]/page.tsx — read-only detail surface", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "page.tsx"),
    "utf-8"
  );
  // Strip comments before negative-substring scans so doc-block
  // mentions of forbidden field names (as documented exclusions)
  // don't trip the assertions. Real code referencing them would
  // survive the strip.
  const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("calls getOrganizationClientById (the wire helper)", () => {
    // The import statement may include adjacent helpers (the audit-card
    // slice landed `listAuditEvents` alongside this one); accept either
    // a single-identifier import OR a multi-identifier import that
    // includes `getOrganizationClientById`.
    expect(SRC).toMatch(
      /import\s*\{[^}]*\bgetOrganizationClientById\b[^}]*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    // Accept either a bare `await getOrganizationClientById(id)` call
    // OR the Promise.all-wrapped invocation landed by the audit-card
    // slice (which awaits the Promise.all rather than the individual
    // call).
    expect(SRC).toMatch(/getOrganizationClientById\(\s*id\s*\)/);
  });

  it("uses oauth_clients capability facts before endpoint calls and keeps the back href", () => {
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "oauth_clients"');
    expect(SRC).toContain("if (capabilityBoundary)");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC).toMatch(/href="\/org-admin\/applications"/);
  });

  it("is server-rendered (no 'use client', no client-side auth check)", () => {
    expect(SRC).not.toMatch(/^"use client";/m);
    expect(SRC).not.toMatch(/getServerSession\(/);
    // Scan the comment-stripped source — the page doc-block names
    // useActionState as a documented exclusion, which would
    // otherwise trip these assertions.
    expect(SRC_NO_COMMENTS).not.toMatch(/useActionState/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useState/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useEffect/);
  });

  it("has a back link to /org-admin/applications", () => {
    expect(SRC).toMatch(/href="\/org-admin\/applications"/);
    expect(SRC).toMatch(/Back to Applications/i);
  });

  it("renders the four error branches: NotFoundPanel, ForbiddenPanel, ErrorPanel, plus invalid → NotFound", () => {
    expect(SRC).toMatch(/function NotFoundPanel\(/);
    expect(SRC).toMatch(/function ForbiddenPanel\(/);
    expect(SRC).toMatch(/function ErrorPanel\(/);
    // The dispatch shape: invalid UUID + result.invalid both render
    // NotFoundPanel; result.notFound also renders it; result.forbidden
    // renders ForbiddenPanel; the fallthrough renders ErrorPanel.
    expect(SRC).toMatch(/result\.notFound[\s\S]*?<NotFoundPanel/);
    expect(SRC).toMatch(/result\.forbidden[\s\S]*?<ForbiddenPanel/);
    expect(SRC).toMatch(/result\.invalid[\s\S]*?<NotFoundPanel/);
  });

  it("pre-filters with a narrow UUID-shape gate before hitting the wire", () => {
    expect(SRC).toMatch(/UUID_RE\s*=\s*\//);
    expect(SRC).toMatch(/!UUID_RE\.test\(id\)/);
  });

  it("renders ONLY the documented operator-safe fields (no secret/token/key material)", () => {
    // The negative invariant — these substrings must not appear in
    // any non-comment code path. The wire helper already drops
    // them; the page additionally never references them.
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      // Inline JWKS private material — `.jwks` access without
      // `_uri` follow-up. The `JWKS URI` operator-copy label is
      // fine; what we forbid is the code path that would read or
      // render inline private-key material from a `jwks` field.
      /\.jwks\b(?!_uri)/,
      // No raw metadata JSON dump.
      /\bclient\.metadata\b/,
      /\be\.metadata\b/,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(SRC_NO_COMMENTS, `detail page must not reference ${pat}`).not.toMatch(pat);
    }
  });

  it("has NO mutation control surfaces (no form, no Edit/Delete/Regenerate/Rotate, no POST/PUT/PATCH/DELETE)", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/<form/);
    expect(SRC_NO_COMMENTS).not.toMatch(/method="POST"/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/method="PUT"/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/method="PATCH"/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/method="DELETE"/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/\bRegenerate\b/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/\bRotate\b/i);
    // The page MUST NOT import any server-action / form helper.
    expect(SRC).not.toMatch(/from\s+["']\.\.\/actions["']/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useActionState/);
  });

  it("renders the documented safe-field labels", () => {
    // The dl/dt/dd rows pin the public-configuration surface.
    expect(SRC).toMatch(/label="Client ID"/);
    expect(SRC).toMatch(/label="Type"/);
    expect(SRC).toMatch(/label="Token endpoint auth method"/);
    expect(SRC).toMatch(/label="Signing algorithm"/);
    expect(SRC).toMatch(/UriListRow label="Redirect URIs"/);
    expect(SRC).toMatch(/UriListRow label="Post-logout redirect URIs"/);
    expect(SRC).toMatch(/UriListRow label="Allowed audiences"/);
    expect(SRC).toMatch(/label="Default scope"/);
    expect(SRC).toMatch(/label="JWKS URI"/);
    expect(SRC).toMatch(/label="Created at"/);
  });
});

describe("/org-admin/applications list page — per-row View details link", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "page.tsx"),
    "utf-8"
  );

  it("each row links to /org-admin/applications/<id> via URL-encoded id", () => {
    expect(SRC).toMatch(
      /href=\{\s*`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}`\s*\}/
    );
  });

  it("each row link has an accessible name 'View application <name>'", () => {
    expect(SRC).toMatch(/aria-label=\{`View application \$\{client\.name\}`\}/);
  });

  it("each row's View-details link has a visible focus ring", () => {
    // Find the View details anchor specifically and inspect its
    // className for the focus-visible:ring-2 utility.
    const linkMatch = SRC.match(
      /href=\{\s*`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}`[\s\S]*?className="([^"]+)"/
    );
    expect(linkMatch).not.toBeNull();
    const cls = linkMatch?.[1] ?? "";
    expect(cls).toMatch(/focus-visible:ring-2/);
  });
});

// ── Edit Application (PUT /api/v1/clients/:id) ─────────────────────────────
//
// The new /org-admin/applications/[id]/edit surface lets an org_admin
// update the operator-safe configuration for an existing OAuth client.
// The IDP's HandleUpdateClient enforces tenant scope server-side
// (`actor.OrganizationID` must match the client's org_id; cross-org
// returns 403), the response intentionally omits `client_secret` (the
// ClientResponse literal does not assign it; `omitempty` drops the
// empty string), and the wire helper sanitises any regression. The
// edit surface deliberately does NOT support Public/Confidential flips
// (which would clear the IDP's stored secret hash without minting a
// replacement, leaving the client unusable) or secret rotation.

describe("types.ts — UpdateOrgClientOptions source contract", () => {
  const TYPES_SRC = readFileSync(resolve(__dirname, "..", "lib", "types.ts"), "utf-8");

  it("declares UpdateOrgClientOptions export", () => {
    expect(TYPES_SRC).toMatch(/export interface UpdateOrgClientOptions\b/);
  });

  it("declares ONLY the safe org_admin self-service edit subset and no secret/token/key/widening field", () => {
    const start = TYPES_SRC.indexOf("export interface UpdateOrgClientOptions");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = TYPES_SRC.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    // Strip JSDoc + line comments so doc-block mentions of forbidden
    // field names (as documented exclusions) do not trip the
    // assertions. Real field declarations survive the strip.
    const block = TYPES_SRC.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Allowed properties — exactly these five.
    expect(block).toMatch(/\bname\?\s*:\s*string\b/);
    expect(block).toMatch(/\bredirect_uris\?\s*:\s*string\[\]/);
    expect(block).toMatch(/\bpost_logout_redirect_uris\?\s*:\s*string\[\]/);
    expect(block).toMatch(/\bscope\?\s*:\s*string\b/);
    expect(block).toMatch(/\ballowed_audiences\?\s*:\s*string\[\]/);
    // Forbidden properties — none may appear.
    const BANNED: RegExp[] = [
      /\borganization_id\b/,
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\bjwks\b/,
      /\bsigning_key\b/,
      /\bsigning_alg\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bservice_account_id\b/,
      /\bskip_consent\b/,
      /\btoken_ttl_secs\b/,
      /\btoken_endpoint_auth_method\b/,
      /\bjwks_uri\b/,
      /\bis_public\b/,
    ];
    for (const pat of BANNED) {
      expect(block, `UpdateOrgClientOptions must not declare ${pat}`).not.toMatch(pat);
    }
  });
});

describe("idp-admin-client.updateOrganizationClient — wire contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the exported function", () => {
    expect(SRC).toMatch(/export async function updateOrganizationClient\b/);
  });

  it("PUTs /api/v1/clients/:id with the id URL-encoded", () => {
    expect(SRC).toMatch(
      /updateOrganizationClient[\s\S]*?\/api\/v1\/clients\/\$\{encodeURIComponent\(id\)\}[\s\S]*?method:\s*"PUT"/
    );
  });

  it("NEVER includes organization_id or client_secret in the OUTGOING request body", () => {
    const fnStart = SRC.indexOf("export async function updateOrganizationClient");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Isolate the outgoing-body construction block — everything
    // between `const body: Record<...> =` and the closing `}`.
    const bodyDeclMatch = body.match(/const\s+body:[\s\S]*?\n\s{2}\}/);
    expect(bodyDeclMatch).not.toBeNull();
    const bodyDecl = bodyDeclMatch?.[0] ?? "";
    expect(bodyDecl).not.toMatch(/organization_id/);
    expect(bodyDecl).not.toMatch(/client_secret/);
    expect(bodyDecl).not.toMatch(/is_public/);
    expect(bodyDecl).not.toMatch(/service_account_id/);
    expect(bodyDecl).not.toMatch(/skip_consent/);
    expect(bodyDecl).not.toMatch(/token_ttl_secs/);
    expect(bodyDecl).not.toMatch(/jwks/);
    expect(bodyDecl).not.toMatch(/token_endpoint_auth_method/);
    expect(bodyDecl).not.toMatch(/signing_alg/);
    // Belt-and-suspenders: no body.<forbidden> assignment elsewhere.
    expect(body).not.toMatch(/body\.organization_id\s*=/);
    expect(body).not.toMatch(/body\.client_secret\s*=/);
    expect(body).not.toMatch(/body\.is_public\s*=/);
  });

  it("maps 400 → invalid, 403 → forbidden, 404 → notFound, 409 → conflict, other non-2xx → generic", () => {
    const fnStart = SRC.indexOf("export async function updateOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).toMatch(/res\.status\s*===\s*400[\s\S]*?invalid:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*403[\s\S]*?forbidden:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*404[\s\S]*?notFound:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*409[\s\S]*?conflict:\s*true/);
  });

  it("sanitiser NEVER reads client_secret / private_key / inline jwks / signing material from the response", () => {
    const fnStart = SRC.indexOf("export async function updateOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toMatch(/c\.client_secret/);
    expect(body).not.toMatch(/c\.private_key/);
    expect(body).not.toMatch(/c\.signing_key/);
    expect(body).not.toMatch(/c\.access_token/);
    expect(body).not.toMatch(/c\.refresh_token/);
    expect(body).not.toMatch(/c\.auth_code/);
    expect(body).not.toMatch(/c\.jwks(?!_uri\b)/);
  });

  it("does NOT log anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function updateOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});

describe("updateApplicationAction — server-action contract", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "actions.ts"),
    "utf-8"
  );

  it("declares the exported action with a clientId-bound signature", () => {
    expect(SRC).toMatch(
      /export async function updateApplicationAction\(\s*clientId:\s*string,\s*_prev:\s*UpdateApplicationState,\s*formData:\s*FormData\s*\)/
    );
  });

  it("re-validates session and the org_admin role", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/getServerSession\(\)/);
    expect(body).toMatch(/role\s*!==\s*"org_admin"/);
    expect(body).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
  });

  it("rejects a non-UUID clientId fail-closed before calling the wire helper", () => {
    expect(SRC).toMatch(/UPDATE_UUID_RE\s*=\s*\//);
    expect(SRC).toMatch(/!UPDATE_UUID_RE\.test\(clientId\)/);
  });

  it("does NOT read organization_id / client_secret / is_public / token-method / jwks / signing / TTL / consent / service-account from form data", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    const body = SRC.slice(fnStart);
    const BANNED: RegExp[] = [
      /formData\.get\(\s*["']organization_id["']\s*\)/,
      /formData\.get\(\s*["']org_id["']\s*\)/,
      /formData\.get\(\s*["']client_secret["']\s*\)/,
      /formData\.get\(\s*["']is_public["']\s*\)/,
      /formData\.get\(\s*["']token_endpoint_auth_method["']\s*\)/,
      /formData\.get\(\s*["']jwks_uri["']\s*\)/,
      /formData\.get\(\s*["']jwks["']\s*\)/,
      /formData\.get\(\s*["']service_account_id["']\s*\)/,
      /formData\.get\(\s*["']skip_consent["']\s*\)/,
      /formData\.get\(\s*["']token_ttl_secs["']\s*\)/,
    ];
    for (const pat of BANNED) {
      expect(body, `updateApplicationAction must not read ${pat}`).not.toMatch(pat);
    }
  });

  it("validates redirect URI inputs and rejects unsafe schemes (re-uses isSafeRedirectURI)", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/isSafeRedirectURI\(uri\)/);
    expect(body).toMatch(/redirectURIs\.length\s*===\s*0/);
    // The negative-scheme regex is declared at module scope above the
    // action; the action does not re-declare it.
    expect(SRC).toMatch(/javascript\|data\|file\|vbscript/);
  });

  it("calls updateOrganizationClient with the safe field subset (name + redirect_uris + post_logout + audiences + scope)", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/updateOrganizationClient\(\s*clientId\s*,\s*\{/);
    expect(body).toMatch(/name,\s*\n\s*redirect_uris:\s*redirectURIs/);
    expect(body).toMatch(/post_logout_redirect_uris:\s*postLogoutURIs/);
    expect(body).toMatch(/allowed_audiences:\s*allowedAudiences/);
    expect(body).toMatch(/scope,/);
  });

  it("revalidatePath fires ONLY on success for BOTH list and detail caches", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    const body = SRC.slice(fnStart);
    const successBranchMatch = body.match(/if\s*\(result\.ok\)\s*\{[\s\S]*?return\s*\{/);
    expect(successBranchMatch).not.toBeNull();
    const successBlock = successBranchMatch?.[0] ?? "";
    expect(successBlock).toMatch(/revalidatePath\("\/org-admin\/applications"\)/);
    expect(successBlock).toMatch(/revalidatePath\(`\/org-admin\/applications\/\$\{clientId\}`\)/);
    // The error branches MUST NOT call revalidatePath.
    const afterSuccess = body.split("if (result.ok)")[1] ?? "";
    const errorTail = afterSuccess.split("if (result.forbidden)")[1] ?? "";
    expect(errorTail).not.toMatch(/revalidatePath/);
  });

  it("NEVER logs anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function updateApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).not.toMatch(/console\.\w+/);
  });

  it("success state envelope does NOT carry client_secret / secret_hash / token-shaped fields", () => {
    // The UpdateApplicationState success branch surfaces only id +
    // client_id + name — no secret material crosses the action
    // boundary on the update path.
    expect(SRC).toMatch(
      /phase:\s*"success";\s*updated:\s*\{\s*id:\s*string;\s*client_id:\s*string;\s*name:\s*string\s*\}/
    );
    expect(SRC).not.toMatch(/updated:\s*\{[^}]*client_secret/);
    expect(SRC).not.toMatch(/updated:\s*\{[^}]*secret_hash/);
    expect(SRC).not.toMatch(/updated:\s*\{[^}]*private_key/);
    expect(SRC).not.toMatch(/updated:\s*\{[^}]*access_token/);
    expect(SRC).not.toMatch(/updated:\s*\{[^}]*refresh_token/);
  });
});

describe("/org-admin/applications/[id]/edit/page.tsx — edit page server-rendered shell", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "edit", "page.tsx"),
    "utf-8"
  );
  const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("calls getOrganizationClientById to prefill safe fields", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*getOrganizationClientById\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/await\s+getOrganizationClientById\(\s*id\s*\)/);
  });

  it("uses oauth_clients capability facts before prefill endpoint calls and keeps the back href", () => {
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "oauth_clients"');
    expect(SRC).toContain("if (capabilityBoundary)");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC).toMatch(/href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(id\)\}`\}/);
  });

  it("is server-rendered (no 'use client', no client-side auth check)", () => {
    expect(SRC).not.toMatch(/^"use client";/m);
    expect(SRC_NO_COMMENTS).not.toMatch(/getServerSession\(/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useActionState/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useState/);
    expect(SRC_NO_COMMENTS).not.toMatch(/useEffect/);
  });

  it("pre-filters with a narrow UUID-shape gate before hitting the wire", () => {
    expect(SRC).toMatch(/UUID_RE\s*=\s*\//);
    expect(SRC).toMatch(/!UUID_RE\.test\(id\)/);
  });

  it("renders the four error branches: NotFoundPanel, ForbiddenPanel, ErrorPanel, plus invalid → NotFound", () => {
    expect(SRC).toMatch(/function NotFoundPanel\(/);
    expect(SRC).toMatch(/function ForbiddenPanel\(/);
    expect(SRC).toMatch(/function ErrorPanel\(/);
    expect(SRC).toMatch(/result\.notFound[\s\S]*?<NotFoundPanel/);
    expect(SRC).toMatch(/result\.forbidden[\s\S]*?<ForbiddenPanel/);
    expect(SRC).toMatch(/result\.invalid[\s\S]*?<NotFoundPanel/);
  });

  it("has a back link to the detail page (NOT the list)", () => {
    expect(SRC).toMatch(/href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(id\)\}`\}/);
    expect(SRC).toMatch(/Back to application details/i);
  });

  it("mounts EditApplicationForm with the safe-field prefill props (no secret / token / key)", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*EditApplicationForm\s*\}\s*from\s+["']\.\/edit-application-form["']/
    );
    expect(SRC).toMatch(/<EditApplicationForm[\s\S]*?clientId=\{\s*id\s*\}/);
    // Pin the prefill prop set: every operator-safe field on
    // OrgClientItem MUST be threaded through. None of the secret-
    // shaped props may appear.
    expect(SRC).toMatch(/initialName=\{client\.name\}/);
    expect(SRC).toMatch(/initialClientID=\{client\.client_id\}/);
    expect(SRC).toMatch(/initialIsPublic=\{client\.is_public\}/);
    expect(SRC).toMatch(/initialAuthMethod=\{client\.token_endpoint_auth_method\}/);
    expect(SRC).toMatch(/initialRedirectURIs=\{client\.redirect_uris\}/);
    expect(SRC).toMatch(/initialPostLogoutRedirectURIs=\{client\.post_logout_redirect_uris\}/);
    expect(SRC).toMatch(/initialAllowedAudiences=\{client\.allowed_audiences\}/);
    expect(SRC).toMatch(/initialScope=\{client\.scope\}/);
    expect(SRC_NO_COMMENTS).not.toMatch(/initialClientSecret/);
    expect(SRC_NO_COMMENTS).not.toMatch(/initialSecret/);
    expect(SRC_NO_COMMENTS).not.toMatch(/initialPrivateKey/);
  });

  it("does NOT render any secret / key / token / mutation-other-than-update affordance", () => {
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      /\bRegenerate\b/i,
      /\bRotate\b/i,
      /\bDelete\b/i,
      // Inline JWKS material — .jwks access without _uri follow-up.
      /\.jwks\b(?!_uri)/,
    ];
    for (const pat of BANNED) {
      expect(SRC_NO_COMMENTS, `edit page must not match ${pat}`).not.toMatch(pat);
    }
  });
});

describe("EditApplicationForm — single-shot update; no secret render", () => {
  const FORM_SRC = readFileSync(
    resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "applications",
      "[id]",
      "edit",
      "edit-application-form.tsx"
    ),
    "utf-8"
  );
  const FORM_SRC_NO_COMMENTS = FORM_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  it("is a 'use client' component using useActionState bound to updateApplicationAction with clientId", () => {
    expect(FORM_SRC).toMatch(/^"use client";/);
    expect(FORM_SRC).toMatch(/updateApplicationAction\.bind\(\s*null,\s*props\.clientId\s*\)/);
    expect(FORM_SRC).toMatch(/useActionState\(\s*boundAction/);
  });

  it("renders the documented safe-field inputs (name + redirect URIs + post-logout URIs + audiences + scope)", () => {
    expect(FORM_SRC).toMatch(/name="name"/);
    expect(FORM_SRC).toMatch(/name="redirect_uris"/);
    expect(FORM_SRC).toMatch(/name="post_logout_redirect_uris"/);
    expect(FORM_SRC).toMatch(/name="allowed_audiences"/);
    expect(FORM_SRC).toMatch(/name="scope"/);
  });

  it("prefills via defaultValue from the server-rendered props (NOT useEffect, NOT controlled state)", () => {
    // Each editable field uses defaultValue so the IDP-fetched values
    // are present on first paint without any client-side fetch.
    expect(FORM_SRC).toMatch(/defaultValue=\{props\.initialName\}/);
    expect(FORM_SRC).toMatch(/defaultValue=\{defaultRedirectURIs\}/);
    expect(FORM_SRC).toMatch(/defaultValue=\{defaultPostLogoutRedirectURIs\}/);
    expect(FORM_SRC).toMatch(/defaultValue=\{defaultAllowedAudiences\}/);
    expect(FORM_SRC).toMatch(/defaultValue=\{props\.initialScope\}/);
    // No useState / useEffect that would mirror values into longer-
    // lived component state.
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/useState/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/useEffect/);
  });

  it("does NOT render any input named 'is_public' / 'token_endpoint_auth_method' / 'jwks_uri' / 'jwks' / 'service_account_id' / 'token_ttl_secs' / 'skip_consent' / 'client_secret'", () => {
    expect(FORM_SRC).not.toMatch(/name="is_public"/);
    expect(FORM_SRC).not.toMatch(/name="token_endpoint_auth_method"/);
    expect(FORM_SRC).not.toMatch(/name="jwks_uri"/);
    expect(FORM_SRC).not.toMatch(/name="jwks"/);
    expect(FORM_SRC).not.toMatch(/name="service_account_id"/);
    expect(FORM_SRC).not.toMatch(/name="token_ttl_secs"/);
    expect(FORM_SRC).not.toMatch(/name="skip_consent"/);
    expect(FORM_SRC).not.toMatch(/name="client_secret"/);
  });

  it("does NOT render any Regenerate / Rotate / Delete affordance", () => {
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/\bRegenerate\b/i);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/\bRotate\b/i);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/\bDelete\b/i);
  });

  it("never writes any value to localStorage / sessionStorage / cookies / URL history", () => {
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/localStorage/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/document\.cookie/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/window\.history/);
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/searchParams/);
  });

  it("never logs anything via console.*", () => {
    expect(FORM_SRC_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });

  it("does NOT reference client_secret / secret_hash / private_key / token-shaped fields anywhere", () => {
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      /Copy this secret/i,
    ];
    for (const pat of BANNED) {
      expect(FORM_SRC_NO_COMMENTS, `edit form must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("on success, the panel links back to the detail page (NOT directly back to the list)", () => {
    expect(FORM_SRC).toMatch(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(clientId\)\}`\}/
    );
    expect(FORM_SRC).toMatch(/Back to application details/i);
  });
});

describe("/org-admin/applications/[id]/page.tsx — Edit application affordance", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "page.tsx"),
    "utf-8"
  );

  it("renders an Edit application link on the detail page header", () => {
    expect(SRC).toMatch(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}\/edit`\}/
    );
    expect(SRC).toMatch(/aria-label=\{`Edit application \$\{client\.name\}`\}/);
    expect(SRC).toMatch(/Edit application/);
  });

  it("the Edit application link has a visible focus ring", () => {
    const linkMatch = SRC.match(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}\/edit`[\s\S]*?className="([^"]+)"/
    );
    expect(linkMatch).not.toBeNull();
    const cls = linkMatch?.[1] ?? "";
    expect(cls).toMatch(/focus-visible:ring-2/);
  });

  it("does NOT introduce a Regenerate or Rotate affordance on the detail page (Delete now lands via the DangerZone client component)", () => {
    const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(SRC_NO_COMMENTS).not.toMatch(/\bRegenerate\b/i);
    expect(SRC_NO_COMMENTS).not.toMatch(/\bRotate\b/i);
    // The detail page mounts the DangerZone (the only "Delete"
    // surface on the page); the DangerZone component is the only
    // place where the destructive action lives. We pin that
    // explicitly here.
    expect(SRC).toMatch(/import\s*\{\s*DangerZone\s*\}\s*from\s+["']\.\/danger-zone["']/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientId=\{result\.data\.id\}/);
  });
});

// ── Delete Application (DELETE /api/v1/clients/:id) ────────────────────────
//
// The new /org-admin/applications/[id] Danger zone surface lets an
// org_admin hard-delete an existing OAuth client after a type-to-
// confirm gate. The IDP's HandleDeleteClient enforces tenant scope
// server-side (`actor.OrganizationID` must match the client's
// org_id; cross-org returns 403), the response carries no body /
// no client_secret / no token material (204 No Content), and the
// service treats already-deleted as success (returns 204) so a
// double-submit cannot 404. The wire helper sanitises the response
// by carrying no payload; the server action revalidates list +
// detail caches and redirects to /org-admin/applications with a
// non-secret `?deleted=<name>` notice so the list surfaces a
// transient "Deleted X." banner.

describe("idp-admin-client.deleteOrganizationClient — wire contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the exported function", () => {
    expect(SRC).toMatch(/export async function deleteOrganizationClient\b/);
  });

  it("DELETEs /api/v1/clients/:id with the id URL-encoded", () => {
    expect(SRC).toMatch(
      /deleteOrganizationClient[\s\S]*?\/api\/v1\/clients\/\$\{encodeURIComponent\(id\)\}[\s\S]*?method:\s*"DELETE"/
    );
  });

  it("NEVER sends a request body, organization_id, or client_secret on the DELETE", () => {
    const fnStart = SRC.indexOf("export async function deleteOrganizationClient");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The fetch call constructed inside this helper MUST NOT pass a
    // `body:` field, MUST NOT pass `Content-Type: application/json`
    // (no body → no content-type), and MUST NOT serialise organization_id
    // or client_secret anywhere.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    expect(body).not.toMatch(/"Content-Type"\s*:/);
    expect(body).not.toMatch(/organization_id/);
    expect(body).not.toMatch(/client_secret/);
    expect(body).not.toMatch(/secret_hash/);
    expect(body).not.toMatch(/private_key/);
    expect(body).not.toMatch(/jwks/);
    expect(body).not.toMatch(/access_token/);
    expect(body).not.toMatch(/refresh_token/);
    expect(body).not.toMatch(/Bearer/);
  });

  it("maps 204/2xx → ok, 400 → invalid, 403 → forbidden, 404 → notFound, other non-2xx → generic", () => {
    const fnStart = SRC.indexOf("export async function deleteOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).toMatch(/res\.status\s*===\s*204|res\.ok/);
    expect(body).toMatch(/res\.status\s*===\s*400[\s\S]*?invalid:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*403[\s\S]*?forbidden:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*404[\s\S]*?notFound:\s*true/);
  });

  it("does NOT log anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function deleteOrganizationClient");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});

describe("deleteApplicationAction — server-action contract", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "actions.ts"),
    "utf-8"
  );

  it("declares the exported action with a clientId + expectedName + expectedClientID bound signature", () => {
    expect(SRC).toMatch(
      /export async function deleteApplicationAction\(\s*clientId:\s*string,\s*expectedName:\s*string,\s*expectedClientID:\s*string,\s*_prev:\s*DeleteApplicationState,\s*formData:\s*FormData\s*\)/
    );
  });

  it("re-validates session and the org_admin role", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/getServerSession\(\)/);
    expect(body).toMatch(/role\s*!==\s*"org_admin"/);
    expect(body).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
  });

  it("rejects a non-UUID clientId fail-closed before calling the wire helper", () => {
    expect(SRC).toMatch(/DELETE_UUID_RE\s*=\s*\//);
    expect(SRC).toMatch(/!DELETE_UUID_RE\.test\(clientId\)/);
  });

  it("requires a confirm form field that matches expectedName OR expectedClientID server-side", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/formData\.get\(\s*["']confirm["']\s*\)/);
    expect(body).toMatch(/confirm\s*!==\s*expectedName\s*&&\s*confirm\s*!==\s*expectedClientID/);
  });

  it("does NOT read organization_id / client_secret / is_public / token-method / jwks / signing / TTL / consent from form data", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    const BANNED: RegExp[] = [
      /formData\.get\(\s*["']organization_id["']\s*\)/,
      /formData\.get\(\s*["']org_id["']\s*\)/,
      /formData\.get\(\s*["']client_secret["']\s*\)/,
      /formData\.get\(\s*["']secret_hash["']\s*\)/,
      /formData\.get\(\s*["']is_public["']\s*\)/,
      /formData\.get\(\s*["']token_endpoint_auth_method["']\s*\)/,
      /formData\.get\(\s*["']jwks_uri["']\s*\)/,
      /formData\.get\(\s*["']jwks["']\s*\)/,
      /formData\.get\(\s*["']service_account_id["']\s*\)/,
      /formData\.get\(\s*["']skip_consent["']\s*\)/,
      /formData\.get\(\s*["']token_ttl_secs["']\s*\)/,
    ];
    for (const pat of BANNED) {
      expect(body, `deleteApplicationAction must not read ${pat}`).not.toMatch(pat);
    }
  });

  it("calls deleteOrganizationClient with ONLY the clientId arg", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/deleteOrganizationClient\(\s*clientId\s*\)/);
  });

  it("on success revalidates list + detail caches and redirects to the list with a non-secret deleted= notice", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    // The full success branch contains nested `${...}` template
    // interpolation, so a regex that bounds the block with a single
    // `}` would prematurely close at the interpolation's `}`. Scan
    // the full action body for the documented success sequence
    // instead — every assertion individually anchors on tokens that
    // are unique to the success path.
    expect(body).toMatch(/if\s*\(result\.ok\)\s*\{/);
    expect(body).toMatch(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?revalidatePath\("\/org-admin\/applications"\)/
    );
    expect(body).toMatch(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?revalidatePath\(`\/org-admin\/applications\/\$\{clientId\}`\)/
    );
    expect(body).toMatch(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?redirect\(\s*\n?\s*`\/org-admin\/applications\?deleted=\$\{encodeURIComponent\(expectedName\)\}`/
    );
  });

  it("treats 404 already-gone as success-equivalent (no detail-page redirect-back-to-stale-row)", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    const notFoundBranchMatch = body.match(
      /if\s*\(result\.notFound\)\s*\{[\s\S]*?redirect\(\s*\n?\s*`\/org-admin\/applications\?deleted=/
    );
    expect(notFoundBranchMatch).not.toBeNull();
  });

  it("NEVER logs anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function deleteApplicationAction");
    const body = SRC.slice(fnStart);
    expect(body).not.toMatch(/console\.\w+/);
  });

  it("DeleteApplicationState union has NO success-phase secret material (the success path redirects, never surfaces a secret envelope)", () => {
    // The DeleteApplicationState union is intentionally narrow:
    // idle | error. There is NO success phase because the action
    // redirects on success and never returns a payload to the form.
    expect(SRC).toMatch(
      /export type DeleteApplicationState\s*=\s*\|\s*\{\s*phase:\s*"idle"\s*\}\s*\|\s*\{\s*phase:\s*"error"/
    );
    // The string `phase: "success"` MUST NOT appear in the delete
    // type union — it would imply a returned payload with potential
    // secret material.
    const typeDeclMatch = SRC.match(
      /export type DeleteApplicationState[\s\S]*?(?=\nexport |\n\nconst|\n\nexport)/
    );
    const typeDecl = typeDeclMatch?.[0] ?? "";
    expect(typeDecl).not.toMatch(/phase:\s*"success"/);
  });
});

describe("/org-admin/applications/[id]/danger-zone.tsx — Danger zone client component", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "danger-zone.tsx"),
    "utf-8"
  );
  const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is a 'use client' component", () => {
    expect(SRC).toMatch(/^"use client";/);
  });

  it("binds deleteApplicationAction with clientId + clientName + clientID before mounting useActionState", () => {
    expect(SRC).toMatch(
      /deleteApplicationAction\.bind\(\s*null,\s*clientId,\s*clientName,\s*clientID\s*\)/
    );
    expect(SRC).toMatch(/useActionState\(\s*boundAction/);
  });

  it("uses a two-step expand pattern — first click does NOT POST", () => {
    // Initial render shows the ExpandPanel (no form action attached).
    // The "Delete application" button on that panel is a type="button"
    // that flips local React state via setExpanded(true). Only AFTER
    // the operator clicks again on the DeleteConfirmForm's submit
    // does a POST go out.
    expect(SRC).toMatch(/function ExpandPanel\(/);
    expect(SRC).toMatch(/function DeleteConfirmForm\(/);
    expect(SRC).toMatch(/type="button"[\s\S]*?onClick=\{onExpand\}/);
    expect(SRC).toMatch(/setExpanded\(true\)/);
    // The initial branch renders ExpandPanel; only when expanded does
    // the form (with form-action attached) render.
    expect(SRC).toMatch(/!expanded\s*\?\s*\(\s*<ExpandPanel/);
  });

  it("renders a type-to-confirm input that gates submit until it matches name OR client_id", () => {
    // The input name is "confirm" (read by the server action).
    expect(SRC).toMatch(/name="confirm"/);
    // The submit-disabled gate depends on the trimmed input matching
    // either the clientName or the OAuth client_id.
    expect(SRC).toMatch(
      /matches\s*=\s*trimmed\s*===\s*clientName\s*\|\|\s*trimmed\s*===\s*clientID/
    );
    // The Button receives disabled={submitDisabled} which is false
    // only when matches AND not pending.
    expect(SRC).toMatch(/disabled=\{submitDisabled\}/);
    expect(SRC).toMatch(/submitDisabled\s*=\s*!matches\s*\|\|\s*pending/);
  });

  it("shows operator-facing copy stating the action cannot be undone", () => {
    expect(SRC).toMatch(/cannot be undone/i);
  });

  it("does NOT render any secret / key / token / regenerate / rotate / mutation-other-than-delete affordance", () => {
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      /\bRegenerate\b/i,
      /\bRotate\b/i,
      /\.jwks\b(?!_uri)/,
      /Copy this secret/i,
    ];
    for (const pat of BANNED) {
      expect(SRC_NO_COMMENTS, `danger zone must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("never writes any value to localStorage / sessionStorage / cookies / URL history", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/localStorage/);
    expect(SRC_NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(SRC_NO_COMMENTS).not.toMatch(/document\.cookie/);
    expect(SRC_NO_COMMENTS).not.toMatch(/window\.history/);
    expect(SRC_NO_COMMENTS).not.toMatch(/searchParams/);
  });

  it("never logs anything via console.*", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });

  it("does NOT render any input named 'client_secret' / 'is_public' / 'organization_id' / advanced-auth-method fields — the only input is 'confirm'", () => {
    expect(SRC).not.toMatch(/name="client_secret"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
    expect(SRC).not.toMatch(/name="is_public"/);
    expect(SRC).not.toMatch(/name="token_endpoint_auth_method"/);
    expect(SRC).not.toMatch(/name="jwks_uri"/);
    expect(SRC).not.toMatch(/name="jwks"/);
    expect(SRC).not.toMatch(/name="service_account_id"/);
  });
});

describe("/org-admin/applications/[id]/page.tsx — DangerZone mount + Edit affordance preserved", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "page.tsx"),
    "utf-8"
  );

  it("imports + mounts DangerZone with the safe-non-secret props", () => {
    expect(SRC).toMatch(/import\s*\{\s*DangerZone\s*\}\s*from\s+["']\.\/danger-zone["']/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientId=\{result\.data\.id\}/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientName=\{result\.data\.name\}/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientID=\{result\.data\.client_id\}/);
  });

  it("Edit application affordance from the prior slice is preserved", () => {
    expect(SRC).toMatch(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}\/edit`\}/
    );
    expect(SRC).toMatch(/aria-label=\{`Edit application \$\{client\.name\}`\}/);
  });
});

describe("/org-admin/applications/page.tsx — Deleted notice from ?deleted= query", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "page.tsx"),
    "utf-8"
  );

  it("reads ?deleted from searchParams and renders a DeletedNotice when present", () => {
    expect(SRC).toMatch(/searchParams\?:\s*Promise<\{\s*deleted\?:\s*string\s*\}>/);
    expect(SRC).toMatch(/const\s+deletedName/);
    expect(SRC).toMatch(/\{deletedName\s*&&\s*<DeletedNotice\s+name=\{deletedName\}/);
    expect(SRC).toMatch(/function DeletedNotice\(/);
    expect(SRC).toMatch(/Deleted \{name\}\./);
  });

  it("DeletedNotice uses semantic output with aria-live=polite", () => {
    expect(SRC).toMatch(/<output/);
    expect(SRC).toMatch(/aria-live="polite"/);
  });
});

// ── Rotate Application Secret (POST /api/v1/clients/:id/secret/regenerate) ─
//
// The new Security section on /org-admin/applications/[id] lets an
// org_admin rotate a CONFIDENTIAL OAuth client's secret. Public
// clients see a read-only "no secret to rotate" notice and the
// rotation form / button never renders. The IDP enforces tenant scope
// + rejects public clients (400) + emits AuditClientSecretRotated.
// The wire helper sends NO request body and surfaces ONLY the four
// documented fields (id / client_id / name / client_secret); the
// server action stays on the same page after success so the React
// useActionState envelope can render the copy-once panel.

describe("idp-admin-client.rotateOrganizationClientSecret — wire contract", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the exported function", () => {
    expect(SRC).toMatch(/export async function rotateOrganizationClientSecret\b/);
  });

  it("POSTs /api/v1/clients/:id/secret/regenerate with the id URL-encoded", () => {
    expect(SRC).toMatch(
      /rotateOrganizationClientSecret[\s\S]*?\/api\/v1\/clients\/\$\{encodeURIComponent\(id\)\}\/secret\/regenerate[\s\S]*?method:\s*"POST"/
    );
  });

  it("NEVER sends a request body, Content-Type, organization_id, or client_secret on the POST", () => {
    const fnStart = SRC.indexOf("export async function rotateOrganizationClientSecret");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Isolate the fetch call init object. The rotation helper MUST NOT
    // set a `body:` property or a `Content-Type` header — an empty
    // POST is what reaches the IDP. The body MUST NOT serialise
    // organization_id, client_secret, secret_hash, or any secret-
    // shaped field anywhere.
    const initMatch = body.match(/method:\s*"POST"[\s\S]*?\}\s*\n\s*\)/);
    expect(initMatch).not.toBeNull();
    const initBlock = initMatch?.[0] ?? "";
    expect(initBlock).not.toMatch(/body:/);
    expect(initBlock).not.toMatch(/"Content-Type"/);
    expect(body).not.toMatch(/organization_id/);
    expect(body).not.toMatch(/client_secret_hash/);
    expect(body).not.toMatch(/secret_hash/);
    expect(body).not.toMatch(/private_key/);
    expect(body).not.toMatch(/\bjwks\b/);
    expect(body).not.toMatch(/access_token/);
    expect(body).not.toMatch(/refresh_token/);
    expect(body).not.toMatch(/authorization_code/);
    expect(body).not.toMatch(/Bearer/);
    // Specifically: the OUTGOING request must NOT carry client_secret.
    // (The RESPONSE projection legitimately READS d.client_secret to
    // surface the new value back to the caller; that's the copy-once
    // path.)
    expect(initBlock).not.toMatch(/client_secret/);
  });

  it("maps 400 → invalid+publicClient, 403 → forbidden, 404 → notFound, other non-2xx → generic", () => {
    const fnStart = SRC.indexOf("export async function rotateOrganizationClientSecret");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).toMatch(
      /res\.status\s*===\s*400[\s\S]*?invalid:\s*true[\s\S]*?publicClient:\s*true/
    );
    expect(body).toMatch(/res\.status\s*===\s*403[\s\S]*?forbidden:\s*true/);
    expect(body).toMatch(/res\.status\s*===\s*404[\s\S]*?notFound:\s*true/);
  });

  it("sanitises the response by explicit projection to ONLY id/client_id/name/client_secret", () => {
    const fnStart = SRC.indexOf("export async function rotateOrganizationClientSecret");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = (fnEnd >= 0 ? tail.slice(0, fnEnd) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The success-branch data object must declare exactly the four
    // documented fields — nothing else may be read from the wire
    // envelope.
    const successMatch = body.match(/ok:\s*true,[\s\S]*?data:\s*\{[\s\S]*?\}\s*,/);
    expect(successMatch).not.toBeNull();
    const successBlock = successMatch?.[0] ?? "";
    expect(successBlock).toMatch(/\bid:\s*String\(d\.id/);
    expect(successBlock).toMatch(/\bclient_id:\s*String\(d\.client_id/);
    expect(successBlock).toMatch(/\bname:\s*String\(d\.name/);
    expect(successBlock).toMatch(/\bclient_secret:\s*typeof\s+d\.client_secret\s*===\s*"string"/);
    // Forbidden field names — none may appear in the projection.
    expect(successBlock).not.toMatch(/d\.client_secret_hash/);
    expect(successBlock).not.toMatch(/d\.secret_hash/);
    expect(successBlock).not.toMatch(/d\.private_key/);
    expect(successBlock).not.toMatch(/d\.access_token/);
    expect(successBlock).not.toMatch(/d\.refresh_token/);
    expect(successBlock).not.toMatch(/d\.jwks/);
    expect(successBlock).not.toMatch(/d\.organization_id/);
  });

  it("does NOT log anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function rotateOrganizationClientSecret");
    const tail = SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});

describe("rotateApplicationSecretAction — server-action contract", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "actions.ts"),
    "utf-8"
  );

  it("declares the exported action with clientId + expectedName + expectedClientID bound signature", () => {
    expect(SRC).toMatch(
      /export async function rotateApplicationSecretAction\(\s*clientId:\s*string,\s*expectedName:\s*string,\s*expectedClientID:\s*string,\s*_prev:\s*RotateApplicationSecretState,\s*formData:\s*FormData\s*\)/
    );
  });

  it("re-validates session and the org_admin role", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/getServerSession\(\)/);
    expect(body).toMatch(/role\s*!==\s*"org_admin"/);
    expect(body).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
  });

  it("rejects a non-UUID clientId fail-closed before calling the wire helper", () => {
    expect(SRC).toMatch(/ROTATE_UUID_RE\s*=\s*\//);
    expect(SRC).toMatch(/!ROTATE_UUID_RE\.test\(clientId\)/);
  });

  it("requires a confirm form field that matches expectedName OR expectedClientID server-side", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/formData\.get\(\s*["']confirm["']\s*\)/);
    expect(body).toMatch(/confirm\s*!==\s*expectedName\s*&&\s*confirm\s*!==\s*expectedClientID/);
  });

  it("does NOT read organization_id / client_secret / old_secret / new_secret / secret_hash from form data", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    const BANNED: RegExp[] = [
      /formData\.get\(\s*["']organization_id["']\s*\)/,
      /formData\.get\(\s*["']org_id["']\s*\)/,
      /formData\.get\(\s*["']client_secret["']\s*\)/,
      /formData\.get\(\s*["']secret_hash["']\s*\)/,
      /formData\.get\(\s*["']old_secret["']\s*\)/,
      /formData\.get\(\s*["']new_secret["']\s*\)/,
      /formData\.get\(\s*["']is_public["']\s*\)/,
      /formData\.get\(\s*["']token_endpoint_auth_method["']\s*\)/,
      /formData\.get\(\s*["']jwks_uri["']\s*\)/,
      /formData\.get\(\s*["']jwks["']\s*\)/,
      /formData\.get\(\s*["']service_account_id["']\s*\)/,
    ];
    for (const pat of BANNED) {
      expect(body, `rotateApplicationSecretAction must not read ${pat}`).not.toMatch(pat);
    }
  });

  it("calls rotateOrganizationClientSecret with ONLY the clientId arg", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    expect(body).toMatch(/rotateOrganizationClientSecret\(\s*clientId\s*\)/);
  });

  it("on success revalidates BOTH list + detail caches and DOES NOT redirect", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    // Both caches invalidate.
    expect(body).toMatch(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?revalidatePath\("\/org-admin\/applications"\)/
    );
    expect(body).toMatch(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?revalidatePath\(`\/org-admin\/applications\/\$\{clientId\}`\)/
    );
    // The success branch must NOT redirect — it returns the success
    // envelope so the SuccessPanel can render the copy-once secret.
    const successMatch = body.match(
      /if\s*\(result\.ok\)\s*\{[\s\S]*?return\s*\{\s*\n\s*phase:\s*"success"/
    );
    expect(successMatch).not.toBeNull();
    const successBlock = successMatch?.[0] ?? "";
    expect(successBlock).not.toMatch(/redirect\(/);
  });

  it("RotateApplicationSecretState success envelope carries client_secret ONLY in the rotated object (not at the top level)", () => {
    // The phase "success" branch shape: { phase: "success"; rotated:
    // { id; client_id; name; client_secret } }. The secret lives
    // inside `rotated`, not as a top-level field — that lets future
    // refactors strip the wrapper but never moves the secret to a
    // different surface.
    expect(SRC).toMatch(
      /phase:\s*"success";\s*rotated:\s*\{[\s\S]*?client_secret:\s*string;[\s\S]*?\};?\s*\}/
    );
    // No "error" branch must carry client_secret.
    const errorMatch = SRC.match(/phase:\s*"error";\s*error:[\s\S]*?\};?\s*\|/);
    expect(errorMatch).not.toBeNull();
    const errorBlock = errorMatch?.[0] ?? "";
    expect(errorBlock).not.toMatch(/client_secret/);
  });

  it("NEVER logs anything via console.*", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    expect(body).not.toMatch(/console\.\w+/);
  });

  it("maps publicClient backend result to a precise operator-facing message", () => {
    const fnStart = SRC.indexOf("export async function rotateApplicationSecretAction");
    const body = SRC.slice(fnStart);
    // The action must check result.publicClient and surface a
    // distinct error message that explains the constraint.
    expect(body).toMatch(/result\.publicClient/);
    expect(body).toMatch(/[Pp]ublic clients do not have a client secret to rotate/);
  });
});

describe("/org-admin/applications/[id]/security-section.tsx — Security section client component", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "security-section.tsx"),
    "utf-8"
  );
  const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is a 'use client' component", () => {
    expect(SRC).toMatch(/^"use client";/);
  });

  it("branches on isPublic — public clients see only a no-secret notice; no rotate form or button", () => {
    // The top-level SecuritySection renders the PublicClientNotice
    // when isPublic is true and the ConfidentialRotateSurface
    // otherwise. Pin the branch shape.
    expect(SRC).toMatch(/\{isPublic\s*\?\s*\(\s*<PublicClientNotice/);
    expect(SRC).toMatch(/function PublicClientNotice\(/);
    expect(SRC).toMatch(/Public clients do not have a client secret to rotate/i);
  });

  it("PublicClientNotice does NOT render any rotation form / button / input", () => {
    const start = SRC.indexOf("function PublicClientNotice(");
    expect(start).toBeGreaterThan(0);
    const end = SRC.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    const block = SRC.slice(start, end);
    expect(block).not.toMatch(/<form/);
    expect(block).not.toMatch(/<button/);
    expect(block).not.toMatch(/<input/);
    expect(block).not.toMatch(/Rotate client secret/i);
    expect(block).not.toMatch(/useActionState/);
  });

  it("ConfidentialRotateSurface binds rotateApplicationSecretAction with the three closure args and uses useActionState", () => {
    expect(SRC).toMatch(
      /rotateApplicationSecretAction\.bind\(\s*null,\s*clientId,\s*clientName,\s*clientID\s*\)/
    );
    expect(SRC).toMatch(/useActionState\(\s*boundAction/);
  });

  it("uses a two-step expand pattern — first click does NOT POST", () => {
    expect(SRC).toMatch(/function ExpandPanel\(/);
    expect(SRC).toMatch(/function RotateConfirmForm\(/);
    expect(SRC).toMatch(/type="button"[\s\S]*?onClick=\{onExpand\}/);
    expect(SRC).toMatch(/setExpanded\(true\)/);
    expect(SRC).toMatch(/!expanded\s*\?\s*\(\s*<ExpandPanel/);
  });

  it("renders a type-to-confirm input that gates submit until it matches name OR client_id", () => {
    expect(SRC).toMatch(/name="confirm"/);
    expect(SRC).toMatch(
      /matches\s*=\s*trimmed\s*===\s*clientName\s*\|\|\s*trimmed\s*===\s*clientID/
    );
    expect(SRC).toMatch(/disabled=\{submitDisabled\}/);
    expect(SRC).toMatch(/submitDisabled\s*=\s*!matches\s*\|\|\s*pending/);
  });

  it("success panel renders the copy-once warning AND the existing-token-expiry caveat", () => {
    // The success branch surfaces the new client_secret EXACTLY ONCE
    // inside a labelled <dd>. The copy-once warning copy + the
    // token-expiry caveat are both load-bearing. JSX wraps copy across
    // lines so the regex tolerates intervening whitespace/newlines.
    expect(SRC).toMatch(/Copy this secret now\.\s+It will not be shown again/i);
    expect(SRC).toMatch(
      /Existing access tokens issued before rotation continue to validate until\s+they expire/i
    );
    expect(SRC).toMatch(/Future token requests using the old secret will fail/i);
    // The success panel reads `rotated.client_secret` to render it.
    expect(SRC).toMatch(/rotated\.client_secret/);
  });

  it("the new client_secret is ONLY rendered inside the SuccessPanel function — never in ExpandPanel / RotateConfirmForm / top-level", () => {
    // Bounded check: count occurrences of `rotated.client_secret` in
    // the comment-stripped source. The SuccessPanel reads it for
    // display; nothing else should. Allow up to 2 references (a
    // hasSecret-style guard plus the <dd> rendering) — a third
    // would mean the secret is leaking elsewhere.
    const matches = SRC_NO_COMMENTS.match(/rotated\.client_secret/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does NOT render any input named client_secret / old_secret / new_secret / organization_id / advanced-auth-method field — the only input is 'confirm'", () => {
    expect(SRC).not.toMatch(/name="client_secret"/);
    expect(SRC).not.toMatch(/name="old_secret"/);
    expect(SRC).not.toMatch(/name="new_secret"/);
    expect(SRC).not.toMatch(/name="secret_hash"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
    expect(SRC).not.toMatch(/name="is_public"/);
    expect(SRC).not.toMatch(/name="token_endpoint_auth_method"/);
    expect(SRC).not.toMatch(/name="jwks_uri"/);
    expect(SRC).not.toMatch(/name="jwks"/);
    expect(SRC).not.toMatch(/name="service_account_id"/);
  });

  it("never writes any value to localStorage / sessionStorage / cookies / URL history / router.push with secret", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/localStorage/);
    expect(SRC_NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(SRC_NO_COMMENTS).not.toMatch(/document\.cookie/);
    expect(SRC_NO_COMMENTS).not.toMatch(/window\.history/);
    expect(SRC_NO_COMMENTS).not.toMatch(/searchParams/);
    expect(SRC_NO_COMMENTS).not.toMatch(/router\.push/);
  });

  it("never logs anything via console.*", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });

  it("does NOT mirror the secret into useState / useEffect / longer-lived state", () => {
    // The ONLY persistent state is the transient `expanded` flag and
    // the controlled `confirm` input. The secret lives in the
    // useActionState envelope only.
    const successPanelStart = SRC.indexOf("function SuccessPanel(");
    expect(successPanelStart).toBeGreaterThan(0);
    const successPanelBlock = SRC.slice(successPanelStart);
    expect(successPanelBlock).not.toMatch(/useState\(/);
    expect(successPanelBlock).not.toMatch(/useEffect\(/);
  });
});

describe("/org-admin/applications/[id]/page.tsx — SecuritySection mount above DangerZone", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "page.tsx"),
    "utf-8"
  );

  it("imports + mounts SecuritySection with the safe-non-secret props (including isPublic)", () => {
    expect(SRC).toMatch(/import\s*\{\s*SecuritySection\s*\}\s*from\s+["']\.\/security-section["']/);
    expect(SRC).toMatch(/<SecuritySection[\s\S]*?clientId=\{result\.data\.id\}/);
    expect(SRC).toMatch(/<SecuritySection[\s\S]*?clientName=\{result\.data\.name\}/);
    expect(SRC).toMatch(/<SecuritySection[\s\S]*?clientID=\{result\.data\.client_id\}/);
    expect(SRC).toMatch(/<SecuritySection[\s\S]*?isPublic=\{result\.data\.is_public\}/);
  });

  it("SecuritySection renders ABOVE DangerZone", () => {
    const securityIdx = SRC.indexOf("<SecuritySection");
    const dangerIdx = SRC.indexOf("<DangerZone");
    expect(securityIdx).toBeGreaterThan(0);
    expect(dangerIdx).toBeGreaterThan(0);
    expect(securityIdx).toBeLessThan(dangerIdx);
  });

  it("DangerZone mount is preserved (delete flow unchanged)", () => {
    expect(SRC).toMatch(/import\s*\{\s*DangerZone\s*\}\s*from\s+["']\.\/danger-zone["']/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientId=\{result\.data\.id\}/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientName=\{result\.data\.name\}/);
    expect(SRC).toMatch(/<DangerZone[\s\S]*?clientID=\{result\.data\.client_id\}/);
  });
});

// ── Recent activity card on /org-admin/applications/[id] ───────────────────
//
// The IDP backend slice identuum-20260530-client-audit-resource-subjects
// made client audit events filterable by subject_id = client UUID
// (subject_type = "oauth_client"). The application detail page now
// surfaces a compact Recent activity card mounted between DetailCard
// and SecuritySection. Compact rows render the safe operator-facing
// label + the raw event_type + actor + the
// timestamp — NEVER ip_address / user_agent / raw metadata / JSON.stringify
// / client_secret / secret_hash / private_key / token / cookie /
// session-id fields.

describe("application-detail-audit.ts — helper module", () => {
  const SRC = readFileSync(
    resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "applications",
      "[id]",
      "application-detail-audit.ts"
    ),
    "utf-8"
  );

  it("declares APPLICATION_RECENT_ACTIVITY_COPY with exact operator-facing strings", () => {
    expect(SRC).toMatch(/export const APPLICATION_RECENT_ACTIVITY_COPY\s*=\s*\{/);
    expect(SRC).toMatch(/title:\s*"Recent activity"/);
    expect(SRC).toMatch(
      /subtitle:\s*"Latest audit events where this application is the subject\."/
    );
    expect(SRC).toMatch(/viewAllLabel:\s*"View all →"/);
    expect(SRC).toMatch(/emptyBody:\s*"No recent activity recorded for this application\."/);
    expect(SRC).toMatch(/errorBody:\s*"Could not load recent activity/);
  });

  it("declares APPLICATION_AUDIT_EVENT_LABELS with the documented five-event allowlist", () => {
    expect(SRC).toMatch(/client_created:\s*"Application created"/);
    expect(SRC).toMatch(/client_updated:\s*"Application updated"/);
    expect(SRC).toMatch(/client_secret_rotated:\s*"Client secret rotated"/);
    expect(SRC).toMatch(/client_deleted:\s*"Application deleted"/);
    expect(SRC).toMatch(/client_linked_service_account:\s*"Service account linked"/);
  });

  it("getApplicationAuditEventLabel returns a safe fallback for unknown / empty event types", () => {
    expect(SRC).toMatch(/export function getApplicationAuditEventLabel\([^)]*\):\s*string/);
    expect(SRC).toMatch(/return "Application activity";/);
    expect(SRC).toMatch(/return known \?\? eventType;/);
  });

  it("buildOrgAdminApplicationAuditHref URI-encodes both segments and roots at /org-admin/audit", () => {
    expect(SRC).toMatch(
      /export function buildOrgAdminApplicationAuditHref\(\s*applicationID:\s*string,\s*eventType\?:\s*string\s*\):\s*string/
    );
    expect(SRC).toMatch(/\/org-admin\/audit\?subject_id=\$\{encodeURIComponent\(applicationID\)\}/);
    expect(SRC).toMatch(/&event_type=\$\{encodeURIComponent\(eventType\)\}/);
    // NEVER /site-admin/audit in EXECUTABLE source — strip JSDoc /
    // line comments first so the helper's documentation explaining
    // the contract does not produce a false positive.
    const NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(NO_COMMENTS).not.toMatch(/\/site-admin\/audit/);
  });

  it("helper source has no console.* / no localStorage / no secret-shaped reference", () => {
    const NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
    expect(NO_COMMENTS).not.toMatch(/localStorage/);
    expect(NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(NO_COMMENTS).not.toMatch(/document\.cookie/);
    // The helper is purely a label map + href builder; it must not
    // reference any secret-shaped identifier.
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      /\bbearer\b/i,
      /Set-Cookie/i,
      /\bsession_id\b/,
      /JSON\.stringify\(/,
      /\.metadata\b/,
      /\.ip_address\b/,
      /\.user_agent\b/,
    ];
    for (const pat of BANNED) {
      expect(NO_COMMENTS, `helper must not reference ${pat}`).not.toMatch(pat);
    }
  });
});

describe("application-detail-audit.ts — behavioural pins", () => {
  it("getApplicationAuditEventLabel returns the documented label for known events", async () => {
    const mod = await import("../app/org-admin/applications/[id]/application-detail-audit");
    expect(mod.getApplicationAuditEventLabel("client_created")).toBe("Application created");
    expect(mod.getApplicationAuditEventLabel("client_updated")).toBe("Application updated");
    expect(mod.getApplicationAuditEventLabel("client_secret_rotated")).toBe(
      "Client secret rotated"
    );
    expect(mod.getApplicationAuditEventLabel("client_deleted")).toBe("Application deleted");
    expect(mod.getApplicationAuditEventLabel("client_linked_service_account")).toBe(
      "Service account linked"
    );
  });

  it("getApplicationAuditEventLabel falls back to the raw event_type for unknown values", async () => {
    const mod = await import("../app/org-admin/applications/[id]/application-detail-audit");
    expect(mod.getApplicationAuditEventLabel("unknown_event")).toBe("unknown_event");
  });

  it("getApplicationAuditEventLabel returns the safe fallback for empty/undefined", async () => {
    const mod = await import("../app/org-admin/applications/[id]/application-detail-audit");
    expect(mod.getApplicationAuditEventLabel("")).toBe("Application activity");
    expect(mod.getApplicationAuditEventLabel(null)).toBe("Application activity");
    expect(mod.getApplicationAuditEventLabel(undefined)).toBe("Application activity");
  });

  it("buildOrgAdminApplicationAuditHref produces the documented URLs", async () => {
    const mod = await import("../app/org-admin/applications/[id]/application-detail-audit");
    const id = "11111111-1111-1111-1111-111111111111";
    expect(mod.buildOrgAdminApplicationAuditHref(id)).toBe(
      `/org-admin/audit?subject_id=${encodeURIComponent(id)}`
    );
    expect(mod.buildOrgAdminApplicationAuditHref(id, "client_secret_rotated")).toBe(
      `/org-admin/audit?subject_id=${encodeURIComponent(id)}&event_type=${encodeURIComponent("client_secret_rotated")}`
    );
  });

  it("buildOrgAdminApplicationAuditHref URI-encodes special characters in both params", async () => {
    const mod = await import("../app/org-admin/applications/[id]/application-detail-audit");
    const id = "id with space & ?";
    const eventType = "event/with/slashes";
    const href = mod.buildOrgAdminApplicationAuditHref(id, eventType);
    expect(href).toContain(encodeURIComponent(id));
    expect(href).toContain(encodeURIComponent(eventType));
    // No raw spaces / ampersands / question marks leaked through.
    expect(href).not.toMatch(/[\s?&]id with space/);
  });
});

describe("/org-admin/applications/[id]/page.tsx — Recent activity wiring", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "applications", "[id]", "page.tsx"),
    "utf-8"
  );
  const SRC_NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports listAuditEvents + AuditEventItem from the wire client", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*?listAuditEvents[\s\S]*?\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
  });

  it("imports the application-detail-audit helper module (label map + href builder + copy)", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*?APPLICATION_RECENT_ACTIVITY_COPY[\s\S]*?buildOrgAdminApplicationAuditHref[\s\S]*?getApplicationAuditEventLabel[\s\S]*?\}\s*from\s+["']\.\/application-detail-audit["']/
    );
  });

  it("calls listAuditEvents with subjectId = the route id, subjectType = oauth_client, pageSize 5 (or 8)", () => {
    expect(SRC).toMatch(
      /listAuditEvents\(\s*\{\s*\n\s*subjectId:\s*id,\s*\n\s*subjectType:\s*"oauth_client",\s*\n\s*pageSize:\s*(5|8)/
    );
  });

  it("DOES NOT pass an organization id to listAuditEvents (org-admin tenant scoping flows through the audit row's actor_organization_id column server-side)", () => {
    // Bounded check on the call site: the options object must not
    // declare an `organizationId` / `organization_id` / `actorOrgId`
    // / `orgId` field.
    const callMatch = SRC.match(/listAuditEvents\(\s*\{[\s\S]*?\}\s*\)/);
    expect(callMatch).not.toBeNull();
    const callBlock = callMatch?.[0] ?? "";
    expect(callBlock).not.toMatch(/organizationId/);
    expect(callBlock).not.toMatch(/organization_id/);
    expect(callBlock).not.toMatch(/actorOrgId/);
    expect(callBlock).not.toMatch(/\borgId\b/);
  });

  it("mounts ApplicationRecentActivity AFTER DetailCard and BEFORE SecuritySection", () => {
    const detailCardIdx = SRC.indexOf("<DetailCard");
    const recentIdx = SRC.indexOf("<ApplicationRecentActivity");
    const securityIdx = SRC.indexOf("<SecuritySection");
    expect(detailCardIdx).toBeGreaterThan(0);
    expect(recentIdx).toBeGreaterThan(0);
    expect(securityIdx).toBeGreaterThan(0);
    expect(detailCardIdx).toBeLessThan(recentIdx);
    expect(recentIdx).toBeLessThan(securityIdx);
  });

  it("DangerZone remains AFTER SecuritySection (delete-flow preserved)", () => {
    const securityIdx = SRC.indexOf("<SecuritySection");
    const dangerIdx = SRC.indexOf("<DangerZone");
    expect(securityIdx).toBeGreaterThan(0);
    expect(dangerIdx).toBeGreaterThan(securityIdx);
  });

  it("ApplicationRecentActivity uses the documented copy via the helper, NEVER inline literal strings", () => {
    expect(SRC).toMatch(/APPLICATION_RECENT_ACTIVITY_COPY\.title/);
    expect(SRC).toMatch(/APPLICATION_RECENT_ACTIVITY_COPY\.subtitle/);
    expect(SRC).toMatch(/APPLICATION_RECENT_ACTIVITY_COPY\.viewAllLabel/);
    expect(SRC).toMatch(/APPLICATION_RECENT_ACTIVITY_COPY\.emptyBody/);
    expect(SRC).toMatch(/APPLICATION_RECENT_ACTIVITY_COPY\.errorBody/);
    // Belt-and-suspenders: the page source MUST NOT inline the
    // literal copy strings (catches a refactor that re-typed them
    // verbatim).
    expect(SRC).not.toMatch(/"Recent activity"\s*;/);
    expect(SRC).not.toMatch(/"Latest audit events where this application is the subject\."/);
  });

  it("View-all link uses buildOrgAdminApplicationAuditHref(applicationID) (no event_type)", () => {
    expect(SRC).toMatch(/href=\{buildOrgAdminApplicationAuditHref\(applicationID\)\}/);
  });

  it("Per-row link uses buildOrgAdminApplicationAuditHref(applicationID, event.event_type)", () => {
    expect(SRC).toMatch(/buildOrgAdminApplicationAuditHref\(applicationID,\s*event\.event_type\)/);
  });

  it("Per-row label is computed from getApplicationAuditEventLabel(event.event_type)", () => {
    expect(SRC).toMatch(/getApplicationAuditEventLabel\(event\.event_type\)/);
  });

  it("Per-row accessible name explicitly names the destination", () => {
    expect(SRC).toMatch(/`View audit event \$\{event\.event_type\} for this application`/);
  });

  it("Per-row link carries the focus-visible:ring-2 keyboard-focus indicator", () => {
    const rowMatch = SRC.match(/href=\{rowHref\}[\s\S]*?className="([^"]+)"/);
    expect(rowMatch).not.toBeNull();
    const cls = rowMatch?.[1] ?? "";
    expect(cls).toMatch(/focus-visible:ring-2/);
  });

  it("Compact row renders ONLY safe fields — NO ip_address / user_agent / raw metadata / JSON.stringify", () => {
    // Scope the assertion to the ApplicationRecentActivityRow body
    // so unrelated detail-page surfaces (which legitimately render
    // operator-safe configuration) are not penalised.
    const rowStart = SRC.indexOf("function ApplicationRecentActivityRow(");
    expect(rowStart).toBeGreaterThan(0);
    const rowEnd = SRC.indexOf("\nfunction ", rowStart + 1);
    const rowBlock = rowEnd > 0 ? SRC.slice(rowStart, rowEnd) : SRC.slice(rowStart);
    const BANNED: RegExp[] = [
      /\bip_address\b/,
      /\buser_agent\b/,
      /\bclient_secret\b/,
      /\bclient_secret_hash\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bsigning_key\b/,
      /\bBearer\b/,
      /Set-Cookie/i,
      /\bsession_id\b/,
      /JSON\.stringify\(/,
      /\.metadata\b/,
      /\bjwks\b/,
    ];
    for (const pat of BANNED) {
      expect(rowBlock, `compact row must not render ${pat}`).not.toMatch(pat);
    }
  });

  it("The page does NOT import AuditIPAddressCell — that component lives only on the dedicated audit page", () => {
    // Strip comments so the JSX-body doc-block (which legitimately
    // names AuditIPAddressCell as a documented exclusion) doesn't
    // trip the assertion. A real import statement would survive the
    // strip.
    expect(SRC_NO_COMMENTS).not.toMatch(/AuditIPAddressCell/);
  });

  it("The page source has NO console.* call", () => {
    expect(SRC_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });

  it("Edit application affordance from the prior slice is preserved", () => {
    expect(SRC).toMatch(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(client\.id\)\}\/edit`\}/
    );
    expect(SRC).toMatch(/aria-label=\{`Edit application \$\{client\.name\}`\}/);
  });
});
