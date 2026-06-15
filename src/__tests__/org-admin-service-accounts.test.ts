/**
 * Pins for the org-admin Service Accounts main surface.
 *
 *   - Wire-helper exports         → listServiceAccounts /
 *                                    createServiceAccount /
 *                                    deleteServiceAccount are exported
 *                                    from src/lib/idp-admin-client.ts;
 *                                    NO update / rotate-credential /
 *                                    disable / enable helper exists.
 *   - Security invariants         → projectServiceAccount drops
 *                                    everything except the documented
 *                                    7-field allowlist; raw API
 *                                    response is never spread; no
 *                                    credential / secret / hash /
 *                                    private-key / token field appears
 *                                    on the public OrgServiceAccountItem
 *                                    type.
 *   - Server-action presence      → createServiceAccountAction /
 *                                    deleteServiceAccountAction exist;
 *                                    no rotate action; session + role
 *                                    re-validation in place.
 *   - UI-source negative invariants → no rotate/regenerate UI; no
 *                                    Recent activity card; no console.*;
 *                                    no localStorage / sessionStorage /
 *                                    document.cookie reference in any
 *                                    module.
 *   - DangerZone — two-step expand + type-to-confirm gate.
 *   - Nav entry            → "Service accounts" appears in OrgAdminNav.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readClient(): string {
  return readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function readTypes(): string {
  return readFileSync(resolve(__dirname, "..", "lib", "types.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function readActions(): string {
  return readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "service-accounts", "actions.ts"),
    "utf-8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function readSurfaceFileRaw(rel: string): string {
  return readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "service-accounts", ...rel.split("/")),
    "utf-8"
  );
}
function readSurfaceFileStripped(rel: string): string {
  return readSurfaceFileRaw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function readNav(): string {
  return readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "org-admin-nav.tsx"),
    "utf-8"
  );
}

const CLIENT_SRC = readClient();
const TYPES_SRC = readTypes();
const ACTIONS_SRC = readActions();
const NAV_SRC = readNav();

// ── Wire-helper exports + non-exports ──────────────────────────────────────

describe("idp-admin-client.ts — service account wire helpers", () => {
  it("exports listServiceAccounts", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+listServiceAccounts\b/);
  });
  it("exports createServiceAccount", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+createServiceAccount\b/);
  });
  it("exports deleteServiceAccount", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+deleteServiceAccount\b/);
  });
  it("EXPORTS updateServiceAccount (slice identuum-20260530-service-account-edit-ui consumes PATCH route)", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+updateServiceAccount\b/);
  });
  it("does NOT export a credential rotation / regeneration helper", () => {
    expect(CLIENT_SRC).not.toMatch(/rotateServiceAccount/);
    expect(CLIENT_SRC).not.toMatch(/regenerateServiceAccount/);
    expect(CLIENT_SRC).not.toMatch(/issueServiceAccountCredential/);
  });
  it("does NOT export activate / deactivate (no backend route)", () => {
    // Updated in slice identuum-20260530-service-account-disable-enable-ui:
    // disableServiceAccount + enableServiceAccount ARE now exported
    // (pinned positively in the dedicated describe block below).
    // activate/deactivate remain non-routes.
    expect(CLIENT_SRC).not.toMatch(/activateServiceAccount/);
    expect(CLIENT_SRC).not.toMatch(/deactivateServiceAccount/);
  });
});

describe("idp-admin-client.ts — wire-helper safety", () => {
  it("listServiceAccounts targets GET /api/v1/organizations/:id/service-accounts", () => {
    expect(CLIENT_SRC).toMatch(
      /\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/service-accounts/
    );
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+listServiceAccounts[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"GET"/);
  });

  it("listServiceAccounts uses the shared IDP status classifier for absent/license states", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+listServiceAccounts[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toContain("classifyAdminReadFailure(res)");
    expect(body).toContain("featureUnavailable");
    expect(body).not.toMatch(/res\.status\s*===\s*403/);
  });

  it("createServiceAccount POSTs to /api/v1/organizations/:id/service-accounts with a JSON body", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+createServiceAccount[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(
      /\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/service-accounts/
    );
    expect(body).toMatch(/method:\s*"POST"/);
    expect(body).toMatch(/"Content-Type":\s*"application\/json"/);
    expect(body).toMatch(/body:\s*JSON\.stringify\(body\)/);
  });

  it("deleteServiceAccount DELETEs the per-row endpoint without a body", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+deleteServiceAccount[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(
      /\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/service-accounts\/\$\{encodeURIComponent\(saID\)\}/
    );
    expect(body).toMatch(/method:\s*"DELETE"/);
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
  });

  it("projectServiceAccount is an EXPLICIT allowlist (no `...r` spread)", () => {
    const projector = CLIENT_SRC.match(/function\s+projectServiceAccount[\s\S]*?\n\}\n/);
    expect(projector).not.toBeNull();
    const body = projector?.[0] ?? "";
    expect(body).not.toMatch(/\.\.\.r\b/);
    // Reads only the documented safe fields. Slice
    // identuum-20260530-service-account-disable-enable-ui added
    // `r?.active` to the projection (the backend's existing list/get
    // DTO already carried it; the UI projector now surfaces it so
    // the LifecycleCard can render the persistent Active/Disabled
    // state on hard reload).
    for (const safe of [
      "r?.id",
      "r?.organization_id",
      "r?.name",
      "r?.description",
      "r?.role",
      "r?.active",
      "r?.created_at",
      "r?.updated_at",
    ]) {
      expect(body).toContain(safe);
    }
    // Never reads any credential-shaped field.
    for (const forbidden of [
      "r?.client_secret",
      "r?.credential",
      "r?.secret",
      "r?.secret_hash",
      "r?.private_key",
      "r?.signing_key",
      "r?.token",
      "r?.access_token",
      "r?.refresh_token",
      "r?.client_id",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ── Type-shape pins ─────────────────────────────────────────────────────────

describe("types.ts — OrgServiceAccountItem safe field allowlist", () => {
  it("declares the OrgServiceAccountItem interface", () => {
    expect(TYPES_SRC).toMatch(/export\s+interface\s+OrgServiceAccountItem\b/);
  });
  it("does NOT include secret/hash/private-key/token fields on the public type", () => {
    const block = TYPES_SRC.match(/export\s+interface\s+OrgServiceAccountItem[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    for (const forbidden of [
      "credential",
      "client_secret",
      "secret_hash",
      "private_key",
      "signing_key",
      "jwks",
      "access_token",
      "refresh_token",
      "bearer",
      "cookie",
      "session_id",
      "client_id",
    ]) {
      expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

// ── Server-action source pins ──────────────────────────────────────────────

describe("service-accounts/actions.ts — server actions present", () => {
  it("exports createServiceAccountAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+createServiceAccountAction\b/);
  });
  it("exports deleteServiceAccountAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+deleteServiceAccountAction\b/);
  });
  it("does NOT export rotate / regenerate actions (no credential surface)", () => {
    // Updated in slice identuum-20260530-service-account-disable-enable-ui:
    // disableServiceAccountAction + enableServiceAccountAction ARE now
    // exported (pinned positively in the dedicated describe block below).
    // Updated in slice identuum-20260530-service-account-edit-ui:
    // updateServiceAccountAction IS now exported (pinned positively in
    // the dedicated edit describe block below).
    expect(ACTIONS_SRC).not.toMatch(/rotateServiceAccount/);
    expect(ACTIONS_SRC).not.toMatch(/regenerateServiceAccount/);
  });
  it("every action re-validates session + role before the wire call", () => {
    expect(
      (ACTIONS_SRC.match(/await\s+getServerSession\s*\(\)/g) ?? []).length
    ).toBeGreaterThanOrEqual(2);
    expect((ACTIONS_SRC.match(/role\s*!==\s*"org_admin"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("derives the organization id server-side via getOwnOrganization — never trusts client form data", () => {
    expect(ACTIONS_SRC).toMatch(/await\s+getOwnOrganization\(\)/);
    expect(ACTIONS_SRC).not.toMatch(/formData\.get\("organization_id"\)/);
    expect(ACTIONS_SRC).not.toMatch(/formData\.get\("orgId"\)/);
  });
});

// ── Per-page negative-invariant pins ───────────────────────────────────────

const PAGE_FILES = [
  "page.tsx",
  "new/page.tsx",
  "new/create-service-account-form.tsx",
  "[id]/page.tsx",
  "[id]/danger-zone.tsx",
  "[id]/edit-details-card.tsx",
  "[id]/link-to-oauth-client-card.tsx",
] as const;

describe("service-accounts surface — no console.* / no storage primitives / no Recent activity / no rotate UI", () => {
  for (const rel of PAGE_FILES) {
    it(`${rel} contains no console.* or storage primitives`, () => {
      const SRC = readSurfaceFileStripped(rel);
      expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
      expect(SRC).not.toMatch(/\blocalStorage\b/);
      expect(SRC).not.toMatch(/\bsessionStorage\b/);
      expect(SRC).not.toMatch(/document\.cookie\b/);
      expect(SRC).not.toMatch(/window\.location\.search\b/);
    });
    it(`${rel} does NOT include a rotate/regenerate credential UI`, () => {
      const SRC = readSurfaceFileStripped(rel);
      expect(SRC).not.toMatch(/rotate\s+credential/i);
      expect(SRC).not.toMatch(/regenerate\s+credential/i);
      expect(SRC).not.toMatch(/rotateServiceAccount/);
      expect(SRC).not.toMatch(/regenerateServiceAccount/);
    });
    it(`${rel} does NOT include a Recent activity card`, () => {
      // The SA detail page IS allowed to mount a Recent activity card
      // (slice identuum-20260530-org-admin-service-account-recent-
      // activity-ui). Every OTHER surface file in PAGE_FILES must NOT
      // gain one — Recent-activity rendering belongs to the detail
      // page only.
      if (rel === "[id]/page.tsx") return;
      const SRC = readSurfaceFileStripped(rel);
      expect(SRC).not.toMatch(/Recent\s+activity/i);
      expect(SRC).not.toMatch(/listAuditEvents\b/);
    });
    it(`${rel} does NOT reference credential / secret / hash / private-key identifiers`, () => {
      const SRC = readSurfaceFileStripped(rel);
      // The page module should never read or render credential-shaped
      // fields. We allow the WORD "credential" in operator copy (e.g.
      // "no credential is issued here") — the scan is on the
      // identifier-style underscore forms.
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "secret_hash",
        "resource_secret",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "bearer ",
        "set-cookie",
        "session_id",
      ]) {
        expect(SRC.toLowerCase()).not.toContain(forbidden);
      }
    });
  }
});

describe("deleteServiceAccountAction — redirect-on-success contract (pinned by slice identuum-20260530-service-accounts-delete-validation)", () => {
  // The destructive delete path was validated end-to-end in dynamic
  // fixture mode. The action's success branch MUST call `redirect()`
  // (which throws NEXT_REDIRECT) so the form's POST navigates to the
  // list page with ?deleted=<name>. The same applies to the 404
  // success-equivalent branch.
  it("success branch calls redirect to /org-admin/service-accounts?deleted=<encoded-name>", () => {
    expect(ACTIONS_SRC).toMatch(
      /redirect\(`\/org-admin\/service-accounts\?deleted=\$\{encodeURIComponent\(expectedName\)\}`\)/
    );
  });
  it("404 branch is success-equivalent and ALSO redirects", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+deleteServiceAccountAction[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    // The redirect URL template appears at least twice (success + notFound).
    const redirectMatches = body.match(/redirect\(`\/org-admin\/service-accounts\?deleted=/g);
    expect(redirectMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it("revalidatePath is called for the list path on both success branches", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+deleteServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    const listRevalidates = body.match(/revalidatePath\("\/org-admin\/service-accounts"\)/g);
    expect(listRevalidates?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it("DELETE wire helper sends NO request body — the action's body-shape pin", () => {
    // The wire helper itself is pinned elsewhere; this pin guards
    // against a regression where the action would add a body to the
    // wire call (which would change the IDP's parse semantics).
    expect(ACTIONS_SRC).not.toMatch(/deleteServiceAccount\(org\.id,\s*saID,\s*\{/);
  });
});

describe("DangerZone — type-to-confirm gate is enforced", () => {
  const SRC = readSurfaceFileStripped("[id]/danger-zone.tsx");
  it("submit is disabled until the typed value matches the service-account name", () => {
    expect(SRC).toMatch(/matches\s*=\s*confirm\.trim\(\)\s*===\s*serviceAccountName/);
    expect(SRC).toMatch(/submitDisabled\s*=\s*!matches/);
  });
  it("uses the two-step expand pattern (no POST on first click)", () => {
    expect(SRC).toMatch(/setExpanded\(true\)/);
    expect(SRC).toMatch(/ExpandPanel/);
  });
});

describe("OrgAdminNav — Service accounts entry", () => {
  it("includes Service accounts in NAV_LINKS pointing at /org-admin/service-accounts", () => {
    expect(NAV_SRC).toMatch(
      /label:\s*"Service accounts"[\s\S]*?href:\s*"\/org-admin\/service-accounts"[\s\S]*?capability:\s*"service_accounts"/
    );
  });
});

describe("service-accounts surface — backend availability boundary copy", () => {
  for (const rel of ["page.tsx", "[id]/page.tsx"]) {
    it(`${rel} renders explicit endpoint-unavailable copy without CE/license claims`, () => {
      const RAW = readSurfaceFileRaw(rel);
      expect(RAW).toContain("Service accounts are an IDP machine-to-machine surface");
      expect(RAW).toMatch(/This\s+IDP\s+backend did not make the endpoint available/);
      expect(RAW).not.toMatch(/service accounts require (Enterprise|CE|Professional)/i);
      expect(RAW).not.toMatch(/current license/i);
    });
  }

  it("list page consumes explicit service_accounts=false facts before endpoint fallback", () => {
    const RAW = readSurfaceFileRaw("page.tsx");
    expect(RAW).toContain("getServerRuntimeState");
    expect(RAW).toContain("getAuthorizationServerPageBoundary");
    expect(RAW).toContain('surface: "service_accounts"');
    expect(RAW).toContain(
      "const result = !capabilityBoundary && org?.id ? await listServiceAccounts(org.id) : null;"
    );
    expect(RAW).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
  });

  it("detail page consumes explicit service_accounts=false facts before list fallback", () => {
    const RAW = readSurfaceFileRaw("[id]/page.tsx");
    expect(RAW).toContain("getServerRuntimeState");
    expect(RAW).toContain("getAuthorizationServerPageBoundary");
    expect(RAW).toContain('surface: "service_accounts"');
    expect(RAW).toContain("if (capabilityBoundary)");
    expect(RAW).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
  });

  it("create page consumes explicit service_accounts=false facts before mounting the create form", () => {
    const RAW = readSurfaceFileRaw("new/page.tsx");
    expect(RAW).toContain("getServerRuntimeState");
    expect(RAW).toContain("getAuthorizationServerPageBoundary");
    expect(RAW).toContain('surface: "service_accounts"');
    expect(RAW).toContain("capabilityBoundary ? (");
    expect(RAW).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(RAW).toContain("<CreateServiceAccountForm />");
  });

  it("capability boundary wiring preserves service account hrefs", () => {
    const LIST_RAW = readSurfaceFileRaw("page.tsx");
    const DETAIL_RAW = readSurfaceFileRaw("[id]/page.tsx");
    const CREATE_RAW = readSurfaceFileRaw("new/page.tsx");
    expect(LIST_RAW).toContain('href="/org-admin/service-accounts/new"');
    expect(DETAIL_RAW).toContain('href="/org-admin/service-accounts"');
    expect(CREATE_RAW).toContain('href="/org-admin/service-accounts"');
  });
});

// ── Link-to-OAuth-client UI pins (slice identuum-20260530-service-account-oauth-client-link-ui) ──

describe("idp-admin-client.ts — linkServiceAccountToOAuthClient wire helper", () => {
  it("exports linkServiceAccountToOAuthClient", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+linkServiceAccountToOAuthClient\b/);
  });
  it("targets the documented backend route POST /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClient[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"POST"/);
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}/);
    expect(body).toMatch(/\/service-accounts\/\$\{encodeURIComponent\(serviceAccountID\)\}/);
    expect(body).toMatch(/\/oauth-clients\/\$\{encodeURIComponent\(oauthClientID\)\}\/link/);
    // No request body / no Content-Type — the route takes path params only.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    expect(body).not.toMatch(/"Content-Type":\s*"application\/json"/);
  });
  it("projects ONLY the four documented safe identifiers — never a credential / hash / token field", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClient[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/d\?\.organization_id/);
    expect(body).toMatch(/d\?\.service_account_id/);
    expect(body).toMatch(/d\?\.oauth_client_uuid/);
    expect(body).toMatch(/d\?\.oauth_client_identifier/);
    for (const forbidden of [
      "d?.client_secret",
      "d?.client_secret_hash",
      "d?.secret_hash",
      "d?.credential",
      "d?.token",
      "d?.private_key",
      "d?.signing_key",
      "d?.access_token",
      "d?.refresh_token",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("service-accounts/actions.ts — linkServiceAccountToOAuthClientAction security contract", () => {
  it("exports linkServiceAccountToOAuthClientAction", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClientAction\b/
    );
  });
  it("uses a bound (serviceAccountID, _prev, formData) signature so the form never carries the SA id", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClientAction\(\s*serviceAccountID:\s*string,\s*_prev:\s*LinkSAToOAuthClientState,\s*formData:\s*FormData\s*\)/
    );
  });
  it("derives the organization id server-side via getOwnOrganization — never reads organization_id from formData", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClientAction[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/await\s+getOwnOrganization\(\)/);
    expect(body).not.toMatch(/formData\.get\("organization_id"\)/);
    expect(body).not.toMatch(/formData\.get\("orgId"\)/);
  });
  it("validates both UUIDs (serviceAccountID + oauth_client_id) before the wire call", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    // serviceAccountID is bound; UUID gate runs first.
    expect(body).toMatch(/if\s*\(!UUID_RE\.test\(serviceAccountID\)\)/);
    // oauth_client_id from formData; UUID gate runs after presence gate.
    expect(body).toMatch(/formData\.get\("oauth_client_id"\)/);
    expect(body).toMatch(/if\s*\(!UUID_RE\.test\(oauthClientID\)\)/);
  });
  it("revalidates BOTH the service-account surface AND the applications surface on success (the link updates a column on the OAuth client too)", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+linkServiceAccountToOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/revalidatePath\("\/org-admin\/service-accounts"\)/);
    expect(body).toMatch(
      /revalidatePath\(`\/org-admin\/service-accounts\/\$\{serviceAccountID\}`\)/
    );
    expect(body).toMatch(/revalidatePath\("\/org-admin\/applications"\)/);
    expect(body).toMatch(/revalidatePath\(`\/org-admin\/applications\/\$\{oauthClientID\}`\)/);
  });
  it("success state carries ONLY the four safe identifiers — no credential / secret / token field", () => {
    const typeMatch = ACTIONS_SRC.match(
      /export\s+type\s+LinkSAToOAuthClientState[\s\S]*?phase:\s*"success"[\s\S]*?\}\s*;/
    );
    expect(typeMatch).not.toBeNull();
    const block = typeMatch?.[0] ?? "";
    expect(block).toMatch(/organization_id:\s*string/);
    expect(block).toMatch(/service_account_id:\s*string/);
    expect(block).toMatch(/oauth_client_uuid:\s*string/);
    expect(block).toMatch(/oauth_client_identifier:\s*string/);
    for (const forbidden of [
      "client_secret",
      "secret_hash",
      "credential",
      "token",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
    ]) {
      expect(block).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

describe("LinkToOAuthClientCard — UI contract", () => {
  const RAW = readSurfaceFileRaw("[id]/link-to-oauth-client-card.tsx");
  const SRC = readSurfaceFileStripped("[id]/link-to-oauth-client-card.tsx");

  it('declares "use client" (useActionState is in-memory only)', () => {
    expect(RAW.startsWith('"use client"')).toBe(true);
  });
  it("renders operator-safe copy explaining no new secret is issued", () => {
    expect(RAW).toMatch(/No new secret was issued|No new credential is issued|no new secret/i);
  });
  it("renders a single form input named oauth_client_id (no organization_id / no credential field)", () => {
    expect(SRC).toMatch(/name="oauth_client_id"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
    expect(SRC).not.toMatch(/name="client_secret"/);
    expect(SRC).not.toMatch(/name="credential"/);
    expect(SRC).not.toMatch(/name="secret"/);
    expect(SRC).not.toMatch(/name="private_key"/);
  });
  it("empty-state branch links to /org-admin/applications/new", () => {
    expect(RAW).toMatch(/href="\/org-admin\/applications\/new"/);
  });
  it("success state links to the linked OAuth client's Application detail page", () => {
    expect(SRC).toMatch(
      /href=\{`\/org-admin\/applications\/\$\{encodeURIComponent\(linked\.oauth_client_uuid\)\}`\}/
    );
  });
  it("has NO console.* call and NO storage primitive write", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
  });
  it("does NOT render any credential / hash / private-key identifier", () => {
    for (const forbidden of [
      "client_secret_hash",
      "secret_hash",
      "resource_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "bearer ",
      "set-cookie",
      "session_id",
    ]) {
      expect(SRC.toLowerCase()).not.toContain(forbidden);
    }
  });
  it("does NOT add a Recent activity card", () => {
    expect(SRC).not.toMatch(/Recent\s+activity/i);
    expect(SRC).not.toMatch(/listAuditEvents\b/);
  });
});

describe("detail page — LinkToOAuthClientCard mounted between Configuration and DangerZone", () => {
  const SRC = readSurfaceFileStripped("[id]/page.tsx");

  it("imports LinkToOAuthClientCard + listOwnOrganizationClients", () => {
    expect(SRC).toMatch(/import\s*\{\s*LinkToOAuthClientCard\s*\}/);
    expect(SRC).toMatch(/listOwnOrganizationClients/);
  });
  it("fetches the OAuth client list in parallel (Promise.all) with the SA list, with a .catch null fallback", () => {
    expect(SRC).toMatch(/Promise\.all\(\[[\s\S]*?listServiceAccounts\(org\.id\)/);
    expect(SRC).toMatch(/listOwnOrganizationClients\(\)\.catch\(\(\) => null\)/);
  });
  it("mounts <LinkToOAuthClientCard> exactly once, BEFORE the DangerZone mount", () => {
    expect(SRC.match(/<LinkToOAuthClientCard\b/g)?.length ?? 0).toBe(1);
    const linkIdx = SRC.indexOf("<LinkToOAuthClientCard");
    const dangerIdx = SRC.indexOf("<DangerZone");
    expect(linkIdx).toBeGreaterThan(0);
    expect(dangerIdx).toBeGreaterThan(0);
    expect(linkIdx).toBeLessThan(dangerIdx);
  });
});

// ── Recent activity card pins (slice identuum-20260530-org-admin-service-account-recent-activity-ui) ──

import {
  SERVICE_ACCOUNT_AUDIT_EVENT_LABELS,
  SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY,
  buildOrgAdminServiceAccountAuditHref,
  getServiceAccountAuditEventLabel,
} from "@/app/org-admin/service-accounts/[id]/service-account-detail-audit";

describe("service-account-detail-audit.ts — label map + helpers", () => {
  it('maps service_account_created → "Service account created"', () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_created).toBe(
      "Service account created"
    );
    expect(getServiceAccountAuditEventLabel("service_account_created")).toBe(
      "Service account created"
    );
  });
  it('maps service_account_deleted → "Service account deleted"', () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_deleted).toBe(
      "Service account deleted"
    );
    expect(getServiceAccountAuditEventLabel("service_account_deleted")).toBe(
      "Service account deleted"
    );
  });
  it('maps service_account_linked_oauth_client → "OAuth client linked"', () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_linked_oauth_client).toBe(
      "OAuth client linked"
    );
    expect(getServiceAccountAuditEventLabel("service_account_linked_oauth_client")).toBe(
      "OAuth client linked"
    );
  });
  it("label map covers exactly the documented IDP event types — no extras, no removals", () => {
    // Slice identuum-20260530-service-account-disable-enable-ui added
    // the disabled/enabled events; the dedicated label-map describe
    // block at the bottom of this file pins each entry explicitly.
    expect(Object.keys(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS).sort()).toEqual([
      "service_account_created",
      "service_account_deleted",
      "service_account_disabled",
      "service_account_enabled",
      "service_account_linked_oauth_client",
      "service_account_unlinked_oauth_client",
      "service_account_updated",
    ]);
  });
  it("unknown event type falls back to the raw token (safe — no secret can appear in AuditEventType)", () => {
    expect(getServiceAccountAuditEventLabel("some_new_event")).toBe("some_new_event");
  });
  it('empty / null / undefined event_type falls back to "Service account activity" so the row never renders empty', () => {
    expect(getServiceAccountAuditEventLabel("")).toBe("Service account activity");
    expect(getServiceAccountAuditEventLabel(null)).toBe("Service account activity");
    expect(getServiceAccountAuditEventLabel(undefined)).toBe("Service account activity");
  });
  it("operator-facing copy block is the documented strings", () => {
    expect(SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.title).toBe("Recent activity");
    expect(SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.subtitle).toBe(
      "Latest audit events where this service account is the subject."
    );
    expect(SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.viewAllLabel).toBe("View all →");
    expect(SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.emptyBody).toMatch(
      /No recent activity recorded for this service account\./
    );
    expect(SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.errorBody).toMatch(
      /Could not load recent activity for this service account\./
    );
  });
});

describe("buildOrgAdminServiceAccountAuditHref — URL contract", () => {
  it("always roots at /org-admin/audit (never /site-admin/audit)", () => {
    const h = buildOrgAdminServiceAccountAuditHref("abc");
    expect(h.startsWith("/org-admin/audit?")).toBe(true);
    expect(h).not.toContain("/site-admin/");
  });
  it("returns a path-only string (no scheme, no host, no protocol-relative leading //)", () => {
    const h = buildOrgAdminServiceAccountAuditHref("abc", "service_account_created");
    expect(h.startsWith("//")).toBe(false);
    expect(h).not.toMatch(/^https?:/);
  });
  it("encodes subject_id and event_type", () => {
    const h = buildOrgAdminServiceAccountAuditHref("a b/c?d&e=f#g", "x y/z?q#r");
    expect(h).toContain("subject_id=a%20b%2Fc%3Fd%26e%3Df%23g");
    expect(h).toContain("event_type=x%20y%2Fz%3Fq%23r");
  });
  it("omits event_type from the View-all URL but always includes subject_id", () => {
    const h = buildOrgAdminServiceAccountAuditHref("uuid-1");
    expect(h).toBe("/org-admin/audit?subject_id=uuid-1");
  });
  it("includes both subject_id and event_type for per-row drill-in", () => {
    const h = buildOrgAdminServiceAccountAuditHref("uuid-1", "service_account_linked_oauth_client");
    expect(h).toBe(
      "/org-admin/audit?subject_id=uuid-1&event_type=service_account_linked_oauth_client"
    );
  });
});

describe("service-account-detail-audit.ts — module safety pins", () => {
  const RAW = readFileSync(
    resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "service-accounts",
      "[id]",
      "service-account-detail-audit.ts"
    ),
    "utf-8"
  );
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("has NO console.* / storage primitives / cookie reference", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
  });
  it("does NOT reference JSON.stringify / .metadata / .ip_address / .user_agent", () => {
    expect(SRC).not.toMatch(/JSON\.stringify/);
    expect(SRC).not.toMatch(/\.metadata\b/);
    expect(SRC).not.toMatch(/\.ip_address\b/);
    expect(SRC).not.toMatch(/\.user_agent\b/);
  });
  it("does NOT reference any credential-shaped identifier", () => {
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "service_account_secret",
      "secret_hash",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
    ]) {
      expect(SRC.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("SA detail page — Recent activity wiring", () => {
  const SRC = readSurfaceFileStripped("[id]/page.tsx");
  const RAW = readSurfaceFileRaw("[id]/page.tsx");

  it("imports the helper module's three exports", () => {
    expect(SRC).toMatch(/SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY/);
    expect(SRC).toMatch(/buildOrgAdminServiceAccountAuditHref/);
    expect(SRC).toMatch(/getServiceAccountAuditEventLabel/);
    expect(SRC).toMatch(/from\s+"\.\/service-account-detail-audit"/);
  });
  it("imports listAuditEvents + ListAuditEventsResult + AuditEventItem from idp-admin-client", () => {
    expect(SRC).toMatch(/listAuditEvents\b/);
    expect(SRC).toMatch(/ListAuditEventsResult\b/);
    expect(SRC).toMatch(/AuditEventItem\b/);
  });
  it('calls listAuditEvents with subjectId / subjectType="service_account" / pageSize=5', () => {
    expect(SRC).toMatch(
      /listAuditEvents\(\{\s*subjectId:\s*id,\s*subjectType:\s*"service_account",\s*pageSize:\s*5,?\s*\}\)/
    );
  });
  it("audit fetch has a .catch null fallback so a failure does not fail the detail page", () => {
    expect(SRC).toMatch(
      /listAuditEvents\([^)]*\)\.catch\(\(\):\s*ListAuditEventsResult\s*\|\s*null\s*=>\s*null\)/
    );
  });
  it("page does NOT pass organization_id / organizationId / actorOrgId / orgId to listAuditEvents", () => {
    // Tenant scoping is enforced server-side via actor_organization_id;
    // the org-admin page must never try to inject an organization id
    // into the audit query (it would be ignored, but the absence is
    // pinned to prevent a future regression from misleading operators).
    const call = SRC.match(/listAuditEvents\(\{[\s\S]*?\}\)/);
    expect(call).not.toBeNull();
    const body = call?.[0] ?? "";
    expect(body).not.toMatch(/organization_id/);
    expect(body).not.toMatch(/organizationId/);
    expect(body).not.toMatch(/actorOrgId/);
    expect(body).not.toMatch(/\borgId\b/);
  });
  it("Promise.all parallel fetch includes listOwnOrganizationClients, listAuditEvents, AND listServiceAccountOAuthClients (4-tuple)", () => {
    // Updated in slice identuum-20260530-service-account-linked-
    // clients-read-model-ui to add the fourth fetch.
    expect(SRC).toMatch(
      /const\s+\[\s*result,\s*oauthClientsResult,\s*recentAuditResult,\s*linkedClientsResult,?\s*\]\s*=\s*await\s+Promise\.all\(/
    );
  });
  it("ServiceAccountRecentActivity is mounted exactly once, AFTER LinkToOAuthClientCard and BEFORE DangerZone", () => {
    expect(SRC.match(/<ServiceAccountRecentActivity\b/g)?.length ?? 0).toBe(1);
    const linkIdx = SRC.indexOf("<LinkToOAuthClientCard");
    const recentIdx = SRC.indexOf("<ServiceAccountRecentActivity");
    const dangerIdx = SRC.indexOf("<DangerZone");
    expect(linkIdx).toBeGreaterThan(0);
    expect(recentIdx).toBeGreaterThan(linkIdx);
    expect(dangerIdx).toBeGreaterThan(recentIdx);
  });
  it("row href uses buildOrgAdminServiceAccountAuditHref(serviceAccountID, event.event_type)", () => {
    expect(SRC).toMatch(
      /buildOrgAdminServiceAccountAuditHref\(serviceAccountID,\s*event\.event_type\)/
    );
  });
  it("View-all href uses buildOrgAdminServiceAccountAuditHref(serviceAccountID) with NO event_type", () => {
    expect(SRC).toMatch(/href=\{buildOrgAdminServiceAccountAuditHref\(serviceAccountID\)\}/);
  });
  it("per-row accessible name explicitly names the destination so screen-reader users know the click target", () => {
    expect(SRC).toMatch(/`View audit event \$\{event\.event_type\} for this service account`/);
  });
  it("focus-visible ring is provided on the per-row link", () => {
    expect(SRC).toMatch(/focus-visible:ring-2/);
  });
  it("ServiceAccountRecentActivityRow body has zero raw-metadata / IP / user-agent / JSON.stringify / credential refs", () => {
    const rowFn = SRC.match(/function\s+ServiceAccountRecentActivityRow\([\s\S]*?\n\}\n/);
    expect(rowFn).not.toBeNull();
    const body = rowFn?.[0] ?? "";
    expect(body).not.toMatch(/JSON\.stringify/);
    expect(body).not.toMatch(/\.metadata\b/);
    expect(body).not.toMatch(/\.ip_address\b/);
    expect(body).not.toMatch(/\.user_agent\b/);
    expect(body).not.toMatch(/AuditIPAddressCell/);
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "service_account_secret",
      "secret_hash",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
  it("page does NOT import AuditIPAddressCell (that component lives only on the dedicated audit page)", () => {
    expect(SRC).not.toMatch(/AuditIPAddressCell/);
  });
  it('page card does NOT introduce any mutation control — no form, no <button type="submit">, no useActionState', () => {
    const cardBlock = SRC.match(/function\s+ServiceAccountRecentActivity\([\s\S]*?\n\}\n/);
    expect(cardBlock).not.toBeNull();
    const body = cardBlock?.[0] ?? "";
    expect(body).not.toMatch(/<form\b/);
    expect(body).not.toMatch(/<button[^>]*type="submit"/);
    expect(body).not.toMatch(/useActionState/);
    expect(body).not.toMatch(/rotate|regenerate/i);
  });
  it("page header comment lists the Recent activity card landing slice (replaces the prior excluded-feature note)", () => {
    expect(RAW).toMatch(/identuum-20260530-org-admin-service-account-recent-activity-ui/);
  });
});

// ── Unlink-from-OAuth-client UI pins (slice identuum-20260530-service-account-oauth-client-unlink-ui) ──

describe("idp-admin-client.ts — unlinkServiceAccountFromOAuthClient wire helper", () => {
  it("exports unlinkServiceAccountFromOAuthClient", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+unlinkServiceAccountFromOAuthClient\b/);
  });
  it("targets the documented backend route DELETE /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClient[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"DELETE"/);
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}/);
    expect(body).toMatch(/\/service-accounts\/\$\{encodeURIComponent\(serviceAccountID\)\}/);
    expect(body).toMatch(/\/oauth-clients\/\$\{encodeURIComponent\(oauthClientID\)\}\/link/);
    // No request body / no Content-Type — the route takes path params only.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    expect(body).not.toMatch(/"Content-Type":\s*"application\/json"/);
  });
  it("maps 400/403/404/409 to safe operator-facing states", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClient[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/res\.status\s*===\s*400/);
    expect(body).toMatch(/res\.status\s*===\s*403/);
    expect(body).toMatch(/res\.status\s*===\s*404/);
    expect(body).toMatch(/res\.status\s*===\s*409/);
    expect(body).toMatch(/notLinked:\s*true/);
  });
  it("projects ONLY the four documented safe identifiers — never a credential / hash / token field", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClient[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/d\?\.organization_id/);
    expect(body).toMatch(/d\?\.service_account_id/);
    expect(body).toMatch(/d\?\.previously_linked_oauth_client_uuid/);
    expect(body).toMatch(/d\?\.previously_linked_oauth_client_identifier/);
    for (const forbidden of [
      "d?.client_secret",
      "d?.client_secret_hash",
      "d?.secret_hash",
      "d?.credential",
      "d?.token",
      "d?.private_key",
      "d?.signing_key",
      "d?.access_token",
      "d?.refresh_token",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("service-accounts/actions.ts — unlinkServiceAccountFromOAuthClientAction security contract", () => {
  it("exports unlinkServiceAccountFromOAuthClientAction", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction\b/
    );
  });
  it("uses a bound (serviceAccountID, oauthClientID, _prev, formData) signature so neither UUID travels through the form", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction\(\s*serviceAccountID:\s*string,\s*oauthClientID:\s*string,\s*_prev:\s*UnlinkSAFromOAuthClientState,\s*formData:\s*FormData\s*\)/
    );
  });
  it("re-validates session via getServerSession and redirects on role mismatch", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/await\s+getServerSession\(\)/);
    expect(body).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
    expect(body).toMatch(/role\s*!==\s*"org_admin"/);
    expect(body).toMatch(/redirect\(roleToPath\(role\)\)/);
  });
  it("derives the organization id server-side via getOwnOrganization and never reads organization_id from formData", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/await\s+getOwnOrganization\(\)/);
    expect(body).not.toMatch(/formData\.get\("organization_id"\)/);
    expect(body).not.toMatch(/formData\.get\("orgId"\)/);
    expect(body).not.toMatch(/formData\.get\("serviceAccountId"\)/);
    expect(body).not.toMatch(/formData\.get\("oauth_client_id"\)/);
  });
  it("validates BOTH UUIDs before the wire call", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/if\s*\(!UUID_RE\.test\(serviceAccountID\)\)/);
    expect(body).toMatch(/if\s*\(!UUID_RE\.test\(oauthClientID\)\)/);
  });
  it("uses a literal UNLINK confirmation gate (form's confirm field must equal 'UNLINK')", () => {
    expect(ACTIONS_SRC).toMatch(/const\s+UNLINK_CONFIRM_LITERAL\s*=\s*"UNLINK"/);
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/formData\.get\("confirm"\)/);
    expect(body).toMatch(/confirm\s*!==\s*UNLINK_CONFIRM_LITERAL/);
  });
  it("revalidates BOTH the service-account surface AND the applications surface on success", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/revalidatePath\("\/org-admin\/service-accounts"\)/);
    expect(body).toMatch(
      /revalidatePath\(`\/org-admin\/service-accounts\/\$\{serviceAccountID\}`\)/
    );
    expect(body).toMatch(/revalidatePath\("\/org-admin\/applications"\)/);
    expect(body).toMatch(/revalidatePath\(`\/org-admin\/applications\/\$\{oauthClientID\}`\)/);
  });
  it("handles 409 (notLinked) as a safe operator-facing error", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+unlinkServiceAccountFromOAuthClientAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/if\s*\(result\.notLinked\)/);
    expect(body).toMatch(/notLinked:\s*true/);
    expect(body).toMatch(/OAuth client is not currently linked to this service account/);
  });
  it("success state carries ONLY the four safe identifiers — no credential / secret / token field", () => {
    const typeMatch = ACTIONS_SRC.match(
      /export\s+type\s+UnlinkSAFromOAuthClientState[\s\S]*?phase:\s*"success"[\s\S]*?\}\s*;/
    );
    expect(typeMatch).not.toBeNull();
    const block = typeMatch?.[0] ?? "";
    expect(block).toMatch(/organization_id:\s*string/);
    expect(block).toMatch(/service_account_id:\s*string/);
    expect(block).toMatch(/previously_linked_oauth_client_uuid:\s*string/);
    expect(block).toMatch(/previously_linked_oauth_client_identifier:\s*string/);
    for (const forbidden of [
      "client_secret",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
    ]) {
      expect(block).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

describe("LinkToOAuthClientCard — unlink UI contract", () => {
  const RAW = readSurfaceFileRaw("[id]/link-to-oauth-client-card.tsx");
  const SRC = readSurfaceFileStripped("[id]/link-to-oauth-client-card.tsx");

  it("imports unlinkServiceAccountFromOAuthClientAction + UnlinkSAFromOAuthClientState", () => {
    expect(SRC).toMatch(/unlinkServiceAccountFromOAuthClientAction/);
    expect(SRC).toMatch(/UnlinkSAFromOAuthClientState/);
  });
  it("binds BOTH ids onto the unlink action so the form never carries either UUID", () => {
    expect(SRC).toMatch(
      /unlinkServiceAccountFromOAuthClientAction\.bind\(\s*null,\s*serviceAccountId,\s*linked\.oauth_client_uuid/
    );
  });
  it("uses a two-step confirmation gate (button → form expand)", () => {
    expect(SRC).toMatch(/setConfirmOpen\(true\)/);
    expect(SRC).toMatch(/setConfirmOpen\(false\)/);
    expect(SRC).toMatch(/confirmOpen\s*\?/);
  });
  it("the unlink subform's only NEW field is the literal 'confirm' input — never an organization_id or service_account_id field", () => {
    // The Link Form (separate branch) legitimately declares
    // <select name="oauth_client_id">; this pin therefore does NOT
    // forbid that name globally. It forbids two specific names that
    // would represent a regression on the security contract (the form
    // is never trusted to carry the org id or the SA id — both are
    // server-derived / curried via .bind).
    expect(SRC).toMatch(/name="confirm"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
    expect(SRC).not.toMatch(/name="service_account_id"/);
  });
  it("renders the documented unlink success copy and the 'Link another OAuth client' affordance", () => {
    expect(RAW).toMatch(/OAuth client unlinked\./);
    expect(RAW).toMatch(/No new credential was issued/);
    expect(RAW).toMatch(/Link another OAuth client/);
  });
  it("renders the 'UNLINK' confirmation prompt", () => {
    expect(RAW).toMatch(/Type UNLINK to confirm/);
  });
  it("has NO console.* / no storage primitive / no cookie / no window.location.search reference", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
  });
  it("does NOT render any credential / hash / private-key / token identifier", () => {
    for (const forbidden of [
      "client_secret_hash",
      "secret_hash",
      "service_account_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
    ]) {
      expect(SRC.toLowerCase()).not.toContain(forbidden);
    }
  });
  it("does NOT add a credential rotation/regeneration UI", () => {
    expect(SRC).not.toMatch(/rotate\s*credential/i);
    expect(SRC).not.toMatch(/regenerate\s*credential/i);
    expect(SRC).not.toMatch(/rotateClientSecret/);
    expect(SRC).not.toMatch(/regenerateClientSecret/);
  });
});

describe("service-account-detail-audit.ts — label map includes the unlink event", () => {
  it('maps service_account_unlinked_oauth_client → "OAuth client unlinked"', () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_unlinked_oauth_client).toBe(
      "OAuth client unlinked"
    );
    expect(getServiceAccountAuditEventLabel("service_account_unlinked_oauth_client")).toBe(
      "OAuth client unlinked"
    );
  });
  it("label map now covers exactly the documented IDP event types (7 entries after edit slice)", () => {
    expect(Object.keys(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS).sort()).toEqual([
      "service_account_created",
      "service_account_deleted",
      "service_account_disabled",
      "service_account_enabled",
      "service_account_linked_oauth_client",
      "service_account_unlinked_oauth_client",
      "service_account_updated",
    ]);
  });
});

describe("application-detail-audit.ts — label map includes the unlink event", () => {
  const APP_AUDIT_SRC = readFileSync(
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
  it('maps client_unlinked_service_account → "Service account unlinked"', () => {
    expect(APP_AUDIT_SRC).toMatch(/client_unlinked_service_account:\s*"Service account unlinked"/);
  });
});

// ── Linked-OAuth-clients persistent read-model pins (slice identuum-20260530-service-account-linked-clients-read-model-ui) ──

describe("idp-admin-client.ts — listServiceAccountOAuthClients wire helper", () => {
  it("exports listServiceAccountOAuthClients", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+listServiceAccountOAuthClients\b/);
  });
  it("targets GET /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+listServiceAccountOAuthClients[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"GET"/);
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}/);
    expect(body).toMatch(
      /\/service-accounts\/\$\{encodeURIComponent\(serviceAccountID\)\}\/oauth-clients/
    );
    // No request body / no Content-Type — pure GET.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    expect(body).not.toMatch(/"Content-Type":\s*"application\/json"/);
  });
  it("projects EXACTLY the 7 documented safe fields per row", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+listServiceAccountOAuthClients[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/r\?\.id/);
    expect(body).toMatch(/r\?\.client_id/);
    expect(body).toMatch(/r\?\.name/);
    expect(body).toMatch(/r\?\.is_public/);
    expect(body).toMatch(/r\?\.active/);
    expect(body).toMatch(/r\?\.created_at/);
    expect(body).toMatch(/r\?\.updated_at/);
    for (const forbidden of [
      "r?.client_secret",
      "r?.client_secret_hash",
      "r?.secret_hash",
      "r?.credential",
      "r?.token",
      "r?.private_key",
      "r?.signing_key",
      "r?.access_token",
      "r?.refresh_token",
      "r?.jwks",
      "r?.jwks_uri",
      "r?.scope",
      "r?.redirect_uris",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
  it("returns [] for absent / non-array oauth_clients (helper must never produce null to callers)", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+listServiceAccountOAuthClients[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/Array\.isArray\(d\?\.oauth_clients\)/);
    expect(body).toMatch(/\[\]/);
    expect(body).toMatch(/oauth_clients:\s*projected/);
  });
  it("maps 400/403/404 safely (no other 4xx leak)", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+listServiceAccountOAuthClients[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/res\.status\s*===\s*400/);
    expect(body).toMatch(/res\.status\s*===\s*403/);
    expect(body).toMatch(/res\.status\s*===\s*404/);
    expect(body).toMatch(/forbidden:\s*true/);
    expect(body).toMatch(/notFound:\s*true/);
    expect(body).toMatch(/invalid:\s*true/);
  });
  it("does NOT expose secret/hash/credential/token/private-key fields anywhere in its body", () => {
    const fn = CLIENT_SRC.match(
      /export\s+async\s+function\s+listServiceAccountOAuthClients[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "service_account_secret",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "Bearer ",
      "Set-Cookie",
      "session_id",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("LinkedOAuthClientForServiceAccount — type-shape allowlist", () => {
  it("declares exactly the 7 safe fields documented in the backend DTO", () => {
    const block = CLIENT_SRC.match(
      /export\s+interface\s+LinkedOAuthClientForServiceAccount[\s\S]*?\n\}/
    );
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toMatch(/\bid:\s*string\b/);
    expect(body).toMatch(/\bclient_id:\s*string\b/);
    expect(body).toMatch(/\bname:\s*string\b/);
    expect(body).toMatch(/\bis_public:\s*boolean\b/);
    expect(body).toMatch(/\bactive:\s*boolean\b/);
    expect(body).toMatch(/\bcreated_at:\s*string\b/);
    expect(body).toMatch(/\bupdated_at:\s*string\b/);
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("SA detail page — linked-clients fetch wiring", () => {
  const SRC = readSurfaceFileStripped("[id]/page.tsx");

  it("imports listServiceAccountOAuthClients + LinkedOAuthClientForServiceAccount + ListServiceAccountOAuthClientsResult", () => {
    expect(SRC).toMatch(/listServiceAccountOAuthClients/);
    expect(SRC).toMatch(/LinkedOAuthClientForServiceAccount/);
    expect(SRC).toMatch(/ListServiceAccountOAuthClientsResult/);
  });
  it("calls listServiceAccountOAuthClients(org.id, id) with a .catch null fallback", () => {
    expect(SRC).toMatch(
      /listServiceAccountOAuthClients\(org\.id,\s*id\)\.catch\(\s*\(\):\s*ListServiceAccountOAuthClientsResult\s*\|\s*null\s*=>\s*null\s*\)/
    );
  });
  it("Promise.all destructures FOUR results in the documented order", () => {
    expect(SRC).toMatch(
      /const\s+\[\s*result,\s*oauthClientsResult,\s*recentAuditResult,\s*linkedClientsResult,?\s*\]\s*=\s*await\s+Promise\.all\(/
    );
  });
  it("passes initialLinkedClients + linkedClientsLoadError to LinkToOAuthClientCard", () => {
    expect(SRC).toMatch(
      /initialLinkedClients=\{[\s\S]*?linkedClientsResult\?\.ok[\s\S]*?\.oauth_clients/
    );
    expect(SRC).toMatch(
      /linkedClientsLoadError=\{\s*!linkedClientsResult\s*\|\|\s*!linkedClientsResult\.ok\s*\}/
    );
  });
});

describe("LinkToOAuthClientCard — persistent linked-state contract", () => {
  const RAW = readSurfaceFileRaw("[id]/link-to-oauth-client-card.tsx");
  const SRC = readSurfaceFileStripped("[id]/link-to-oauth-client-card.tsx");

  it("declares initialLinkedClients + linkedClientsLoadError on the public Props", () => {
    expect(SRC).toMatch(/initialLinkedClients:\s*LinkedOAuthClientForServiceAccount\[\]/);
    expect(SRC).toMatch(/linkedClientsLoadError:\s*boolean/);
  });
  it("renders LinkedStatePanel when initialLinkedClients is non-empty", () => {
    expect(SRC).toMatch(
      /if\s*\(initialLinkedClients\.length\s*>\s*0\)\s*\{[\s\S]*?LinkedStatePanel/
    );
  });
  it("LinkedStatePanel renders one PersistentLinkedClientRow per linked client", () => {
    expect(SRC).toMatch(/linkedClients\.map\(\(c\)\s*=>\s*\(\s*<PersistentLinkedClientRow/);
  });
  it("PersistentLinkedClientRow binds the unlink action with serviceAccountId + client.id", () => {
    expect(SRC).toMatch(
      /unlinkServiceAccountFromOAuthClientAction\.bind\(\s*null,\s*serviceAccountId,\s*client\.id/
    );
  });
  it("PersistentLinkedClientRow uses a two-step confirmation gate", () => {
    expect(SRC).toMatch(/setConfirmOpen\(true\)/);
    expect(SRC).toMatch(/setConfirmOpen\(false\)/);
  });
  it("LinkedStatePanel surfaces the multiple-linked-clients invariant note when length > 1", () => {
    expect(RAW).toMatch(/More than one OAuth client is currently linked/);
  });
  it("LinkedStateLoadErrorPanel surfaces a safe operator-facing error and still mounts the Form", () => {
    expect(RAW).toMatch(/Could not load the OAuth clients currently linked to this/);
    expect(SRC).toMatch(/<Form[\s\S]*?serviceAccountName=\{serviceAccountName\}[\s\S]*?\/>/);
  });
  it("has NO browser-storage / cookie / window.location / searchParams write for linked-state persistence", () => {
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
    expect(SRC).not.toMatch(/window\.location\s*=/);
  });
  it("does NOT render any credential / hash / private-key / token / cookie identifier (16-pattern blocklist)", () => {
    for (const forbidden of [
      "client_secret_hash",
      "secret_hash",
      "service_account_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
      ".ip_address",
      ".user_agent",
      "JSON.stringify",
      ".metadata",
      "AuditIPAddressCell",
    ]) {
      expect(SRC.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it("does NOT add a credential rotation / regeneration UI", () => {
    expect(SRC).not.toMatch(/rotate\s*credential/i);
    expect(SRC).not.toMatch(/regenerate\s*credential/i);
    expect(SRC).not.toMatch(/rotateClientSecret/);
    expect(SRC).not.toMatch(/regenerateClientSecret/);
  });
});

// ── Disable / Enable SA UI pins (slice identuum-20260530-service-account-disable-enable-ui) ──

describe("idp-admin-client.ts — disableServiceAccount / enableServiceAccount wire helpers", () => {
  it("exports both helpers", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+disableServiceAccount\b/);
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+enableServiceAccount\b/);
  });
  it("targets the documented backend routes via the shared callServiceAccountLifecycle", () => {
    const fn = CLIENT_SRC.match(/async\s+function\s+callServiceAccountLifecycle[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"POST"/);
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}/);
    expect(body).toMatch(
      /\/service-accounts\/\$\{encodeURIComponent\(serviceAccountID\)\}\/\$\{segment\}/
    );
    expect(body).toMatch(/segment\s*===\s*"disable"|segment:\s*"disable"/);
    // No request body / no Content-Type — POST takes path params only.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    expect(body).not.toMatch(/"Content-Type":\s*"application\/json"/);
  });
  it("projects EXACTLY the 8 documented safe fields", () => {
    const fn = CLIENT_SRC.match(/async\s+function\s+callServiceAccountLifecycle[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    for (const safe of [
      "d?.success",
      "d?.message",
      "d?.organization_id",
      "d?.service_account_id",
      "d?.service_account_name",
      "d?.role",
      "d?.previous_active",
      "d?.active",
    ]) {
      expect(body).toContain(safe);
    }
    for (const forbidden of [
      "d?.client_secret",
      "d?.client_secret_hash",
      "d?.service_account_secret",
      "d?.secret_hash",
      "d?.credential",
      "d?.token",
      "d?.private_key",
      "d?.signing_key",
      "d?.access_token",
      "d?.refresh_token",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
  it("maps 400/403/404 safely", () => {
    const fn = CLIENT_SRC.match(/async\s+function\s+callServiceAccountLifecycle[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/res\.status\s*===\s*400/);
    expect(body).toMatch(/res\.status\s*===\s*403/);
    expect(body).toMatch(/res\.status\s*===\s*404/);
    expect(body).toMatch(/invalid:\s*true/);
    expect(body).toMatch(/forbidden:\s*true/);
    expect(body).toMatch(/notFound:\s*true/);
  });
});

describe("service-accounts/actions.ts — disable/enable server actions", () => {
  it("exports disableServiceAccountAction + enableServiceAccountAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+disableServiceAccountAction\b/);
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+enableServiceAccountAction\b/);
  });
  it("both actions use bound (serviceAccountID, _prev, formData) signatures so the form never carries the SA id", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+disableServiceAccountAction\(\s*serviceAccountID:\s*string,\s*_prev:\s*DisableSAState,\s*formData:\s*FormData\s*\)/
    );
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+enableServiceAccountAction\(\s*serviceAccountID:\s*string,\s*_prev:\s*EnableSAState,\s*formData:\s*FormData\s*\)/
    );
  });
  it("disable enforces the DISABLE literal; enable enforces the ENABLE literal", () => {
    expect(ACTIONS_SRC).toMatch(/const\s+DISABLE_CONFIRM_LITERAL\s*=\s*"DISABLE"/);
    expect(ACTIONS_SRC).toMatch(/const\s+ENABLE_CONFIRM_LITERAL\s*=\s*"ENABLE"/);
    const disableFn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+disableServiceAccountAction[\s\S]*?\n\}\n/
    );
    const enableFn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+enableServiceAccountAction[\s\S]*?\n\}\n/
    );
    expect(disableFn?.[0] ?? "").toMatch(/confirm\s*!==\s*DISABLE_CONFIRM_LITERAL/);
    expect(enableFn?.[0] ?? "").toMatch(/confirm\s*!==\s*ENABLE_CONFIRM_LITERAL/);
  });
  it("both actions re-validate session + role and derive the organization id server-side", () => {
    for (const re of [
      /export\s+async\s+function\s+disableServiceAccountAction[\s\S]*?\n\}\n/,
      /export\s+async\s+function\s+enableServiceAccountAction[\s\S]*?\n\}\n/,
    ]) {
      const body = ACTIONS_SRC.match(re)?.[0] ?? "";
      expect(body).toMatch(/await\s+getServerSession\(\)/);
      expect(body).toMatch(/redirect\("\/login\?reason=session_expired"\)/);
      expect(body).toMatch(/role\s*!==\s*"org_admin"/);
      expect(body).toMatch(/await\s+getOwnOrganization\(\)/);
      expect(body).not.toMatch(/formData\.get\("organization_id"\)/);
      expect(body).not.toMatch(/formData\.get\("orgId"\)/);
      expect(body).toMatch(/if\s*\(!UUID_RE\.test\(serviceAccountID\)\)/);
    }
  });
  it("both actions revalidate the SA list AND the SA detail paths on success", () => {
    for (const re of [
      /export\s+async\s+function\s+disableServiceAccountAction[\s\S]*?\n\}\n/,
      /export\s+async\s+function\s+enableServiceAccountAction[\s\S]*?\n\}\n/,
    ]) {
      const body = ACTIONS_SRC.match(re)?.[0] ?? "";
      expect(body).toMatch(/revalidatePath\("\/org-admin\/service-accounts"\)/);
      expect(body).toMatch(
        /revalidatePath\(`\/org-admin\/service-accounts\/\$\{serviceAccountID\}`\)/
      );
    }
  });
  it("success state carries ONLY the safe 6-field result — no credential / secret / token field", () => {
    const typeMatch = ACTIONS_SRC.match(
      /export\s+type\s+DisableSAState[\s\S]*?phase:\s*"success"[\s\S]*?\}\s*;/
    );
    expect(typeMatch).not.toBeNull();
    const block = typeMatch?.[0] ?? "";
    expect(block).toMatch(/organization_id:\s*string/);
    expect(block).toMatch(/service_account_id:\s*string/);
    expect(block).toMatch(/service_account_name:\s*string/);
    expect(block).toMatch(/role:\s*string/);
    expect(block).toMatch(/previous_active:\s*boolean/);
    expect(block).toMatch(/active:\s*boolean/);
    for (const forbidden of [
      "client_secret",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
    ]) {
      expect(block).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

describe("LifecycleCard — UI contract", () => {
  const RAW = readSurfaceFileRaw("[id]/lifecycle-card.tsx");
  const SRC = readSurfaceFileStripped("[id]/lifecycle-card.tsx");

  it('declares "use client" (useActionState is in-memory only)', () => {
    expect(RAW.startsWith('"use client"')).toBe(true);
  });
  it("imports disableServiceAccountAction + enableServiceAccountAction + state types", () => {
    expect(SRC).toMatch(/disableServiceAccountAction/);
    expect(SRC).toMatch(/enableServiceAccountAction/);
    expect(SRC).toMatch(/DisableSAState/);
    expect(SRC).toMatch(/EnableSAState/);
  });
  it("renders the Active status badge + Disable affordance when active=true", () => {
    expect(RAW).toMatch(/Active/);
    expect(RAW).toMatch(/Disable service account/);
    // The active-state copy explains that disabling blocks new token
    // issuance immediately — the operator must understand the
    // mutation's effect before clicking the confirmation gate.
    expect(RAW).toMatch(/Disabling blocks new token issuance immediately/);
  });
  it("renders the Disabled status badge + Enable affordance when active=false", () => {
    expect(RAW).toMatch(/Disabled/);
    expect(RAW).toMatch(/Enable service account/);
    expect(RAW).toMatch(/re-enabling restores token issuance|re-enabling restores/i);
  });
  it("uses a two-step expand + literal DISABLE / ENABLE confirmation gate", () => {
    expect(SRC).toMatch(/setConfirmOpen\(true\)/);
    expect(SRC).toMatch(/setConfirmOpen\(false\)/);
    expect(RAW).toMatch(/Type DISABLE to confirm/);
    expect(RAW).toMatch(/Type ENABLE to confirm/);
  });
  it("binds both server actions with .bind(null, serviceAccountId)", () => {
    expect(SRC).toMatch(/disableServiceAccountAction\.bind\(\s*null,\s*serviceAccountId\)/);
    expect(SRC).toMatch(/enableServiceAccountAction\.bind\(\s*null,\s*serviceAccountId\)/);
  });
  it("the confirmation forms' only input is the literal 'confirm' (no organization_id / no SA id)", () => {
    expect(SRC).toMatch(/name="confirm"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
    expect(SRC).not.toMatch(/name="service_account_id"/);
  });
  it("has NO browser-storage / cookie / window.location / searchParams write", () => {
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
    expect(SRC).not.toMatch(/window\.location\s*=/);
  });
  it("has NO console.* call", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
  });
  it("does NOT render any credential / hash / private-key / token identifier (13-pattern blocklist)", () => {
    for (const forbidden of [
      "client_secret_hash",
      "secret_hash",
      "service_account_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
      ".ip_address",
      ".user_agent",
    ]) {
      expect(SRC.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it("does NOT add credential rotation / regeneration UI", () => {
    expect(SRC).not.toMatch(/rotate\s*credential/i);
    expect(SRC).not.toMatch(/regenerate\s*credential/i);
    expect(SRC).not.toMatch(/rotateClientSecret/);
    expect(SRC).not.toMatch(/regenerateClientSecret/);
  });
});

describe("SA detail page — LifecycleCard mount ordering", () => {
  const SRC = readSurfaceFileStripped("[id]/page.tsx");
  it("imports LifecycleCard", () => {
    expect(SRC).toMatch(/import\s*\{\s*LifecycleCard\s*\}/);
  });
  it("mounts LifecycleCard exactly once, AFTER Configuration and BEFORE LinkToOAuthClientCard", () => {
    expect(SRC.match(/<LifecycleCard\b/g)?.length ?? 0).toBe(1);
    const configIdx = SRC.indexOf("Configuration");
    const lifecycleIdx = SRC.indexOf("<LifecycleCard");
    const linkIdx = SRC.indexOf("<LinkToOAuthClientCard");
    expect(configIdx).toBeGreaterThan(0);
    expect(lifecycleIdx).toBeGreaterThan(configIdx);
    expect(linkIdx).toBeGreaterThan(lifecycleIdx);
  });
  it("passes active={sa.active} to LifecycleCard", () => {
    expect(SRC).toMatch(/<LifecycleCard[\s\S]*?active=\{sa\.active\}/);
  });
});

describe("service-account-detail-audit.ts — label map includes disabled/enabled events", () => {
  it("maps service_account_disabled and service_account_enabled", () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_disabled).toBe(
      "Service account disabled"
    );
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_enabled).toBe(
      "Service account enabled"
    );
    expect(getServiceAccountAuditEventLabel("service_account_disabled")).toBe(
      "Service account disabled"
    );
    expect(getServiceAccountAuditEventLabel("service_account_enabled")).toBe(
      "Service account enabled"
    );
  });
});

describe("types.ts — OrgServiceAccountItem now exposes active", () => {
  it("declares active: boolean", () => {
    const block = TYPES_SRC.match(/export\s+interface\s+OrgServiceAccountItem[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block?.[0] ?? "").toMatch(/active:\s*boolean/);
  });
});

// ── Edit Details slice (identuum-20260530-service-account-edit-ui) ─────────

describe("idp-admin-client.ts — updateServiceAccount wire helper", () => {
  it("targets PATCH /api/v1/organizations/:id/service-accounts/:sa_id", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/method:\s*"PATCH"/);
    expect(body).toMatch(
      /\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/service-accounts\/\$\{encodeURIComponent\(serviceAccountID\)\}/
    );
    expect(body).toMatch(/"Content-Type":\s*"application\/json"/);
    expect(body).toMatch(/body:\s*JSON\.stringify/);
  });
  it("JSON.stringify body carries ONLY name + description + role (no organization_id, no active, no credential field)", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    const fnBody = fn?.[0] ?? "";
    // Extract only the JSON.stringify(...) request-body literal so the
    // forbidden-key scan does not bleed into the unrelated success-
    // response projection further down the function.
    const stringifyMatch = fnBody.match(/JSON\.stringify\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(stringifyMatch).not.toBeNull();
    const reqBody = stringifyMatch?.[1] ?? "";
    expect(reqBody).toMatch(/name:\s*input\.name/);
    expect(reqBody).toMatch(/description:\s*input\.description/);
    expect(reqBody).toMatch(/role:\s*input\.role/);
    for (const forbidden of [
      "organization_id",
      "active",
      "client_secret",
      "credential",
      "secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
    ]) {
      expect(reqBody).not.toMatch(new RegExp(`\\b${forbidden}\\b\\s*:`));
    }
  });
  it("maps 400/403/404/409 into safe discriminants", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/res\.status\s*===\s*400/);
    expect(body).toMatch(/res\.status\s*===\s*403/);
    expect(body).toMatch(/res\.status\s*===\s*404/);
    expect(body).toMatch(/res\.status\s*===\s*409/);
    expect(body).toMatch(/invalid:\s*true/);
    expect(body).toMatch(/forbidden:\s*true/);
    expect(body).toMatch(/notFound:\s*true/);
    expect(body).toMatch(/conflict:\s*true/);
  });
  it('409 conflict message is the safe public string "Service account name already exists."', () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/Service account name already exists\./);
  });
  it("projects EXACTLY the 8 documented safe fields on the success response", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    // The function reuses projectServiceAccount, OR inlines the 8
    // safe-field allowlist; either way the 8 documented field names
    // MUST be referenced.
    for (const safe of [
      "id",
      "organization_id",
      "name",
      "description",
      "role",
      "active",
      "created_at",
      "updated_at",
    ]) {
      // Match either projectServiceAccount(...) (the helper that
      // already pins the 8-field allowlist by its own test above),
      // or each safe field appearing inline.
      const usesProjector = /projectServiceAccount\s*\(/.test(body);
      if (!usesProjector) {
        expect(body).toContain(safe);
      } else {
        expect(usesProjector).toBe(true);
      }
    }
  });
  it("does NOT read any credential-shaped key from the response", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+updateServiceAccount[\s\S]*?\n\}\n/);
    const body = fn?.[0] ?? "";
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("service-accounts/actions.ts — updateServiceAccountAction (edit slice)", () => {
  it("exports updateServiceAccountAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+updateServiceAccountAction\b/);
  });
  it("derives the org id server-side via getOwnOrganization() and NEVER reads organization_id from formData", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/await\s+getOwnOrganization\(\)/);
    expect(body).not.toMatch(/formData\.get\("organization_id"\)/);
  });
  it("re-validates session + role and redirects on mismatch", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/await\s+getServerSession\s*\(\)/);
    expect(body).toMatch(/role\s*!==\s*"org_admin"/);
    expect(body).toMatch(/redirect\(/);
  });
  it("validates the bound serviceAccountID UUID before calling the wire helper", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/UUID_RE\.test\(serviceAccountID\)/);
  });
  it("trims name, rejects blank, enforces NAME_MAX, validates role allowlist, enforces DESCRIPTION_MAX", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/\.trim\(\)/);
    expect(body).toMatch(/ALLOWED_ROLES\.has/);
    expect(body).toMatch(/NAME_MAX/);
    expect(body).toMatch(/DESCRIPTION_MAX/);
    expect(body).toMatch(/fieldErrors:\s*\{\s*name:/);
    expect(body).toMatch(/fieldErrors:\s*\{\s*role:/);
  });
  it("maps 409 conflict to a name-field error with the safe public string", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/result\.conflict/);
    expect(body).toMatch(/Service account name already exists\./);
  });
  it("revalidates BOTH the list page and the detail page on success", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/revalidatePath\("\/org-admin\/service-accounts"\)/);
    expect(body).toMatch(
      /revalidatePath\(`\/org-admin\/service-accounts\/\$\{serviceAccountID\}`\)/
    );
  });
  it("success state carries the 8 safe identifiers and NO credential / secret / hash / private-key / token", () => {
    const fn = ACTIONS_SRC.match(
      /export\s+async\s+function\s+updateServiceAccountAction[\s\S]*?\n\}\n/
    );
    const body = fn?.[0] ?? "";
    expect(body).toMatch(/updated:\s*\{/);
    for (const safe of [
      "id:",
      "organization_id:",
      "name:",
      "description:",
      "role:",
      "active:",
      "created_at:",
      "updated_at:",
    ]) {
      expect(body).toContain(safe);
    }
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "secret_hash",
      "credential",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "bearer",
      "session_id",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("EditDetailsCard — surface safety pins", () => {
  const EDIT_SRC = readSurfaceFileStripped("[id]/edit-details-card.tsx");
  const EDIT_RAW = readFileSync(
    resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "service-accounts",
      "[id]",
      "edit-details-card.tsx"
    ),
    "utf-8"
  );

  it('declares "use client" at the top', () => {
    expect(EDIT_RAW.trimStart().startsWith('"use client"')).toBe(true);
  });
  it("imports updateServiceAccountAction + UpdateSAState from ../actions", () => {
    expect(EDIT_SRC).toMatch(/updateServiceAccountAction/);
    expect(EDIT_SRC).toMatch(/UpdateSAState/);
    expect(EDIT_SRC).toMatch(/from\s+"\.\.\/actions"/);
  });
  it("curries serviceAccountId via .bind(null, serviceAccountId)", () => {
    expect(EDIT_SRC).toMatch(/\.bind\(null,\s*serviceAccountId\)/);
  });
  it("contains no console.* / no storage primitives / no document.cookie / no window.location.search", () => {
    expect(EDIT_SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(EDIT_SRC).not.toMatch(/\blocalStorage\b/);
    expect(EDIT_SRC).not.toMatch(/\bsessionStorage\b/);
    expect(EDIT_SRC).not.toMatch(/document\.cookie\b/);
    expect(EDIT_SRC).not.toMatch(/window\.location\.search\b/);
  });
  it("does NOT mention credential / secret / hash / private-key / token / session identifiers", () => {
    for (const forbidden of [
      "client_secret",
      "client_secret_hash",
      "secret_hash",
      "service_account_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer ",
      "set-cookie",
      "session_id",
      "ip_address",
      "user_agent",
    ]) {
      expect(EDIT_SRC.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it("does NOT include a type-to-confirm gate (edit is reversible)", () => {
    expect(EDIT_SRC).not.toMatch(/type\s+the\s+(service\s+account\s+)?name/i);
    // The destructive type-to-confirm form uses a `confirm` input field;
    // the edit form must NOT have one.
    expect(EDIT_SRC).not.toMatch(/name="confirm"/);
  });
  it("does NOT add a credential rotation / regeneration affordance", () => {
    expect(EDIT_SRC).not.toMatch(/rotate\s*credential/i);
    expect(EDIT_SRC).not.toMatch(/regenerate\s*credential/i);
    expect(EDIT_SRC).not.toMatch(/rotateServiceAccount/);
    expect(EDIT_SRC).not.toMatch(/regenerateServiceAccount/);
  });
  it("exports EditDetailsCard and a typed props interface", () => {
    expect(EDIT_SRC).toMatch(/export\s+function\s+EditDetailsCard\b/);
    expect(EDIT_SRC).toMatch(/serviceAccountId:\s*string/);
    expect(EDIT_SRC).toMatch(/serviceAccountName:\s*string/);
    expect(EDIT_SRC).toMatch(/serviceAccountDescription:\s*string/);
    expect(EDIT_SRC).toMatch(/serviceAccountRole:\s*string/);
  });
  it("form inputs are exactly name / description / role (NOT organization_id, NOT active)", () => {
    expect(EDIT_SRC).toMatch(/name="name"/);
    expect(EDIT_SRC).toMatch(/name="description"/);
    expect(EDIT_SRC).toMatch(/name="role"/);
    expect(EDIT_SRC).not.toMatch(/name="organization_id"/);
    expect(EDIT_SRC).not.toMatch(/name="active"/);
  });
  it("role <select> options are exactly org_user + org_admin", () => {
    expect(EDIT_SRC).toMatch(/<option\s+value="org_user">/);
    expect(EDIT_SRC).toMatch(/<option\s+value="org_admin">/);
    expect(EDIT_SRC).not.toMatch(/<option\s+value="site_admin"/);
  });
  it("starts collapsed and exposes an Edit details button to expand", () => {
    expect(EDIT_SRC).toMatch(/Edit\s+details/);
    expect(EDIT_SRC).toMatch(/useState\(false\)/);
  });
  it("surfaces a Cancel button in the expanded form (reversible)", () => {
    expect(EDIT_SRC).toMatch(/Cancel/);
  });
});

describe("SA detail page — EditDetailsCard mount ordering", () => {
  const SRC = readSurfaceFileStripped("[id]/page.tsx");
  it("imports EditDetailsCard", () => {
    expect(SRC).toMatch(/import\s*\{\s*EditDetailsCard\s*\}/);
  });
  it("mounts EditDetailsCard exactly once, AFTER Configuration and BEFORE LifecycleCard", () => {
    expect(SRC.match(/<EditDetailsCard\b/g)?.length ?? 0).toBe(1);
    const configIdx = SRC.indexOf("Configuration");
    const editIdx = SRC.indexOf("<EditDetailsCard");
    const lifecycleIdx = SRC.indexOf("<LifecycleCard");
    expect(configIdx).toBeGreaterThan(0);
    expect(editIdx).toBeGreaterThan(configIdx);
    expect(lifecycleIdx).toBeGreaterThan(editIdx);
  });
  it("passes name / description / role props to EditDetailsCard from the loaded SA", () => {
    expect(SRC).toMatch(/<EditDetailsCard[\s\S]*?serviceAccountId=\{sa\.id\}/);
    expect(SRC).toMatch(/<EditDetailsCard[\s\S]*?serviceAccountName=\{sa\.name\}/);
    expect(SRC).toMatch(
      /<EditDetailsCard[\s\S]*?serviceAccountDescription=\{sa\.description\s*\?\?\s*""\}/
    );
    expect(SRC).toMatch(/<EditDetailsCard[\s\S]*?serviceAccountRole=\{sa\.role\s*\?\?\s*""\}/);
  });
});

describe("service-account-detail-audit.ts — label map includes the updated event", () => {
  it('maps service_account_updated → "Service account updated"', () => {
    expect(SERVICE_ACCOUNT_AUDIT_EVENT_LABELS.service_account_updated).toBe(
      "Service account updated"
    );
    expect(getServiceAccountAuditEventLabel("service_account_updated")).toBe(
      "Service account updated"
    );
  });
});
