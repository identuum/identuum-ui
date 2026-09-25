/**
 * Pins for the org-admin API Resources main surface.
 *
 *   - parseScopeLines             → behavioural pins on the textarea parser.
 *   - Wire-helper exports         → listApiResources / getApiResource /
 *                                    createApiResource / updateApiResource /
 *                                    deleteApiResource are exported from
 *                                    src/lib/idp-admin-client.ts; no rotate
 *                                    helper is exported on this surface.
 *   - Security invariants         → projectAPIResource drops everything except
 *                                    the documented safe allowlist; raw API
 *                                    response is never spread; no secret /
 *                                    hash / private-key field appears on the
 *                                    public OrgAPIResourceItem type.
 *   - Server-action presence      → createApiResourceAction /
 *                                    updateApiResourceAction /
 *                                    deleteApiResourceAction exist; session +
 *                                    role re-validation is in place; the
 *                                    surface does NOT export a rotate action.
 *   - UI-source negative invariants → no rotate/regenerate UI; no Recent
 *                                    activity card; no console.* in the
 *                                    surface modules; no localStorage /
 *                                    sessionStorage / cookie / document.cookie
 *                                    reference in any module.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScopeLines } from "../app/org-admin/api-resources/scope-parser";

// ── parseScopeLines — behavioural pins ──────────────────────────────────────

describe("parseScopeLines — accepts name-only and name:description rows", () => {
  it("returns an empty list for null/undefined/empty input", () => {
    for (const v of [null, undefined, "", "  \n  \n  "]) {
      const r = parseScopeLines(v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.scopes).toEqual([]);
    }
  });

  it("parses a single name-only row (no colon)", () => {
    const r = parseScopeLines("read_billing");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scopes).toEqual([{ name: "read_billing", description: "" }]);
    }
  });

  it("splits on the FIRST colon so the description can contain further colons", () => {
    const r = parseScopeLines("read: Reads billing: invoices and quotes");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scopes[0].name).toBe("read");
      expect(r.scopes[0].description).toBe("Reads billing: invoices and quotes");
    }
  });

  it("parses multiple rows and skips blank lines", () => {
    const r = parseScopeLines("read.billing: Read\n\n\nwrite.billing: Write data\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scopes).toEqual([
        { name: "read.billing", description: "Read" },
        { name: "write.billing", description: "Write data" },
      ]);
    }
  });
});

describe("parseScopeLines — rejects malformed input", () => {
  it("rejects a blank-name row (colon at the start)", () => {
    const r = parseScopeLines(": description only");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Line 1/);
      expect(r.reason).toMatch(/scope name is required/i);
    }
  });

  it("rejects an over-long scope name", () => {
    const longName = "a".repeat(65);
    const r = parseScopeLines(longName);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Line 1/);
      expect(r.reason).toMatch(/64 character maximum/);
    }
  });

  it("rejects an over-long description", () => {
    const longDesc = "d".repeat(256);
    const r = parseScopeLines(`scope:${longDesc}`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/255 character maximum/);
    }
  });

  it("rejects a duplicate scope name on a later line", () => {
    const r = parseScopeLines("read.billing\nwrite.billing\nread.billing");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Line 3/);
      expect(r.reason).toMatch(/duplicate scope/i);
    }
  });
});

// ── Wire-helper source pins ────────────────────────────────────────────────

const CLIENT_SRC = (() => {
  const p = resolve(__dirname, "..", "lib", "idp-admin-client.ts");
  return readFileSync(p, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
})();

describe("idp-admin-client.ts — API resource wire helpers", () => {
  it("exports listApiResources", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+listApiResources\b/);
  });
  it("exports getApiResource", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+getApiResource\b/);
  });
  it("exports createApiResource", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+createApiResource\b/);
  });
  it("exports updateApiResource", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+updateApiResource\b/);
  });
  it("exports deleteApiResource", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+deleteApiResource\b/);
  });
  it("exports rotateApiResourceSecret (added by identuum-20260530-org-admin-api-resource-rotate-secret-ui)", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+rotateApiResourceSecret\b/);
    // The wire helper's name uses `rotate`; no alternate spelling like
    // regenerateApiResourceSecret is exported.
    expect(CLIENT_SRC).not.toMatch(/export\s+async\s+function\s+regenerateApiResourceSecret\b/);
  });
});

describe("idp-admin-client.ts — rotateApiResourceSecret wire safety", () => {
  it("targets the exact backend route POST /api/v1/api-resources/:id/secret/regenerate", () => {
    expect(CLIENT_SRC).toMatch(
      /\/api\/v1\/api-resources\/\$\{encodeURIComponent\(id\)\}\/secret\/regenerate/
    );
  });
  it("sends an empty POST — no body field, no Content-Type header", () => {
    const fnMatch = CLIENT_SRC.match(
      /export\s+async\s+function\s+rotateApiResourceSecret[\s\S]*?\n\}\n/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    expect(body).toMatch(/method:\s*"POST"/);
    // No JSON body literal anywhere in the helper.
    expect(body).not.toMatch(/body:\s*JSON\.stringify/);
    // No explicit Content-Type header for this rotate call.
    expect(body).not.toMatch(/"Content-Type"\s*:\s*"application\/json"/);
  });
  it("projects the response to ONLY {id, secret} — never the resource_secret_hash or any other field", () => {
    const fnMatch = CLIENT_SRC.match(
      /export\s+async\s+function\s+rotateApiResourceSecret[\s\S]*?\n\}\n/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    // The projection reads the OSS rotate envelope's api_resource.id and
    // resource_secret (THE-INVERTED-GUARD: the old {id, secret} read was an
    // envelope mismatch — the server never served those keys). No other
    // property access.
    expect(body).toMatch(/d\?\.api_resource\?\.id/);
    expect(body).toMatch(/d\?\.resource_secret\b/);
    expect(body).not.toMatch(/d\?\.resource_secret_hash\b/);
    expect(body).not.toMatch(/d\?\.secret_hash\b/);
    expect(body).not.toMatch(/d\?\.private_key\b/);
    expect(body).not.toMatch(/d\?\.signing_key\b/);
    expect(body).not.toMatch(/d\?\.access_token\b/);
    expect(body).not.toMatch(/d\?\.refresh_token\b/);
    expect(body).not.toMatch(/d\?\.jwks\b/);
  });
});

describe("idp-admin-client.ts — projectAPIResource is the only mapper, never spreads raw response", () => {
  it("projectAPIResource exists and is the sole mapper for API resources", () => {
    expect(CLIENT_SRC).toMatch(/function\s+projectAPIResource\b/);
  });
  it("projectAPIResource does not spread raw response (no `...r,`)", () => {
    // Defence-in-depth: spreading the raw object would silently pass any
    // future backend field (including a sensitive one) through to React.
    const projectorMatch = CLIENT_SRC.match(/function\s+projectAPIResource[\s\S]*?\n\}/);
    expect(projectorMatch).not.toBeNull();
    expect(projectorMatch?.[0] ?? "").not.toMatch(/\.\.\.r\b/);
  });
});

// ── Type-shape pins ─────────────────────────────────────────────────────────

const TYPES_SRC = (() => {
  const p = resolve(__dirname, "..", "lib", "types.ts");
  return readFileSync(p, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
})();

describe("types.ts — OrgAPIResourceItem safe field allowlist", () => {
  it("declares the OrgAPIResourceItem interface", () => {
    expect(TYPES_SRC).toMatch(/export\s+interface\s+OrgAPIResourceItem\b/);
  });

  it("declares the OrgAPIResourceScope interface", () => {
    expect(TYPES_SRC).toMatch(/export\s+interface\s+OrgAPIResourceScope\b/);
  });

  it("does NOT include secret/hash/private-key/token/jwks fields on the public type", () => {
    const interfaceMatch = TYPES_SRC.match(/export\s+interface\s+OrgAPIResourceItem[\s\S]*?\n\}/);
    expect(interfaceMatch).not.toBeNull();
    const block = interfaceMatch?.[0] ?? "";
    for (const forbidden of [
      "resource_secret",
      "secret",
      "secret_hash",
      "private_key",
      "signing_key",
      "jwks",
      "access_token",
      "refresh_token",
      "bearer",
      "cookie",
      "session_id",
    ]) {
      expect(block).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

// ── Server-action source pins ──────────────────────────────────────────────

const ACTIONS_SRC = (() => {
  const p = resolve(__dirname, "..", "app", "org-admin", "api-resources", "actions.ts");
  return readFileSync(p, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
})();

describe("api-resources/actions.ts — server actions present", () => {
  it("exports createApiResourceAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+createApiResourceAction\b/);
  });
  it("exports updateApiResourceAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+updateApiResourceAction\b/);
  });
  it("exports deleteApiResourceAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+deleteApiResourceAction\b/);
  });
  it("exports rotateApiResourceSecretAction (added by identuum-20260530-org-admin-api-resource-rotate-secret-ui)", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+rotateApiResourceSecretAction\b/);
    expect(ACTIONS_SRC).not.toMatch(/regenerateApiResourceSecretAction\b/);
  });
  it("every action re-validates session + role before the wire call", () => {
    // 4 actions now (create, update, delete, rotate). Each MUST call
    // getServerSession() and redirect on role !== "org_admin".
    expect(
      (ACTIONS_SRC.match(/await\s+getServerSession\s*\(\)/g) ?? []).length
    ).toBeGreaterThanOrEqual(4);
    expect((ACTIONS_SRC.match(/role\s*!==\s*"org_admin"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("api-resources/actions.ts — rotateApiResourceSecretAction security contract", () => {
  it("uses the bound-args curry signature (resourceId, expectedName, expectedAudience, _prev, formData)", () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+rotateApiResourceSecretAction\(\s*resourceId:\s*string,\s*expectedName:\s*string,\s*expectedAudience:\s*string,\s*_prev:\s*RotateAPIResourceSecretState,\s*formData:\s*FormData\s*\)/
    );
  });
  it("validates UUID-shape on resourceId BEFORE calling the wire", () => {
    expect(ACTIONS_SRC).toMatch(/if\s*\(!UUID_RE\.test\(resourceId\)\)/);
  });
  it("reads ONLY the `confirm` form field — no secret-shaped form keys", () => {
    const fnMatch = ACTIONS_SRC.match(
      /export\s+async\s+function\s+rotateApiResourceSecretAction[\s\S]*?\n\}\n/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    expect(body).toMatch(/formData\.get\("confirm"\)/);
    expect(body).not.toMatch(/formData\.get\("resource_secret"\)/);
    expect(body).not.toMatch(/formData\.get\("old_secret"\)/);
    expect(body).not.toMatch(/formData\.get\("new_secret"\)/);
    expect(body).not.toMatch(/formData\.get\("secret_hash"\)/);
    expect(body).not.toMatch(/formData\.get\("organization_id"\)/);
  });
  it("enforces the type-to-confirm gate server-side against name OR audience", () => {
    expect(ACTIONS_SRC).toMatch(
      /confirm\s*!==\s*expectedName\s*&&\s*confirm\s*!==\s*expectedAudience/
    );
  });
  it("revalidates BOTH list + detail caches on success (no redirect — keeps the secret in the React envelope)", () => {
    const fnMatch = ACTIONS_SRC.match(
      /export\s+async\s+function\s+rotateApiResourceSecretAction[\s\S]*?\n\}\n/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    expect(body).toMatch(/revalidatePath\("\/org-admin\/api-resources"\)/);
    expect(body).toMatch(/revalidatePath\(`\/org-admin\/api-resources\/\$\{resourceId\}`\)/);
    // No redirect call in the success branch.
    const successIdx = body.indexOf('phase: "success"');
    expect(successIdx).toBeGreaterThan(0);
    // No `redirect(` between the OK check and the success return.
    const okIdx = body.indexOf("if (result.ok)");
    expect(okIdx).toBeGreaterThan(0);
    const successWindow = body.slice(okIdx, successIdx);
    expect(successWindow).not.toMatch(/\bredirect\s*\(/);
  });
  it("RotateAPIResourceSecretState success envelope declares ONLY id/name/audience/secret — no hash", () => {
    const typeMatch = ACTIONS_SRC.match(
      /export\s+type\s+RotateAPIResourceSecretState[\s\S]*?phase:\s*"success"[\s\S]*?\}\s*;/
    );
    expect(typeMatch).not.toBeNull();
    const block = typeMatch?.[0] ?? "";
    expect(block).toMatch(/id:\s*string/);
    expect(block).toMatch(/name:\s*string/);
    expect(block).toMatch(/audience:\s*string/);
    expect(block).toMatch(/secret:\s*string/);
    expect(block).not.toMatch(/secret_hash:/);
    expect(block).not.toMatch(/resource_secret_hash:/);
    expect(block).not.toMatch(/private_key:/);
    expect(block).not.toMatch(/old_secret:/);
  });
});

// ── UI-page negative-invariant pins ────────────────────────────────────────

function readModule(rel: string): string {
  const p = resolve(__dirname, "..", "app", "org-admin", "api-resources", ...rel.split("/"));
  return readFileSync(p, "utf-8");
}

function readModuleStripped(rel: string): string {
  return readModule(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// All surface files. Each must pass the no-console.* / no-storage scan.
// The rotate-UI scan applies to every file EXCEPT
// [id]/security-section.tsx (the single authorised rotate-UI home,
// added 2026-05-30). The no-Recent-activity scan applies to every
// file EXCEPT [id]/page.tsx and [id]/api-resource-detail-audit.ts
// (the Recent activity card landed 2026-05-30 in slice
// identuum-20260530-org-admin-api-resource-detail-audit-card-ui).
const PAGE_FILES = [
  "page.tsx",
  "new/page.tsx",
  "new/create-api-resource-form.tsx",
  "[id]/page.tsx",
  "[id]/danger-zone.tsx",
  "[id]/security-section.tsx",
  "[id]/api-resource-detail-audit.ts",
  "[id]/edit/page.tsx",
  "[id]/edit/edit-api-resource-form.tsx",
];

const PAGE_FILES_NO_ROTATE = PAGE_FILES.filter((rel) => rel !== "[id]/security-section.tsx");

const PAGE_FILES_NO_RECENT_ACTIVITY = PAGE_FILES.filter(
  (rel) => rel !== "[id]/page.tsx" && rel !== "[id]/api-resource-detail-audit.ts"
);

describe("api-resources surface — no console.*, no storage primitives", () => {
  for (const rel of PAGE_FILES) {
    it(`${rel} contains no console.* or storage primitives`, () => {
      const SRC = readModule(rel)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
      expect(SRC).not.toMatch(/\blocalStorage\b/);
      expect(SRC).not.toMatch(/\bsessionStorage\b/);
      expect(SRC).not.toMatch(/document\.cookie\b/);
    });
  }
});

describe("api-resources surface — OSS/Starter Authorization Server boundary copy", () => {
  for (const rel of ["page.tsx", "[id]/page.tsx", "[id]/edit/page.tsx"]) {
    it(`${rel} does not describe API resources as missing from the current license`, () => {
      const SRC = readModule(rel);
      expect(SRC).toContain("OSS/Starter Authorization Server surface");
      expect(SRC).toContain("This IDP backend did not make the endpoint available");
      expect(SRC).not.toMatch(/license does not include the Authorization Server/i);
    });
  }

  it("rotate/delete wire messages are backend-availability-neutral", () => {
    expect(CLIENT_SRC).toContain(
      "The API resource endpoint is not available from this IDP backend"
    );
    expect(CLIENT_SRC).not.toMatch(/Authorization Server feature is not enabled/i);
  });

  it("listApiResources uses the shared IDP status classifier for absent/license states", () => {
    const fn = CLIENT_SRC.match(/export\s+async\s+function\s+listApiResources[\s\S]*?\n\}\n/);
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toContain("classifyAdminReadFailure(res)");
    expect(body).not.toMatch(/res\.status\s*===\s*402\s*\|\|\s*res\.status\s*===\s*404/);
  });

  it("list page consumes explicit api_resources=false facts before endpoint fallback", () => {
    const SRC = readModule("page.tsx");
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "api_resources"');
    expect(SRC).toContain("const result = capabilityBoundary ? null : await listApiResources();");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
  });

  it("detail page consumes explicit api_resources=false facts before direct resource fetch", () => {
    const SRC = readModule("[id]/page.tsx");
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "api_resources"');
    expect(SRC).toContain("if (capabilityBoundary)");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
  });

  it("create page consumes explicit api_resources=false facts before mounting the create form", () => {
    const SRC = readModule("new/page.tsx");
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "api_resources"');
    expect(SRC).toContain("capabilityBoundary ? (");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC).toContain("<CreateApiResourceForm />");
  });

  it("edit page consumes explicit api_resources=false facts before direct resource fetch", () => {
    const SRC = readModule("[id]/edit/page.tsx");
    expect(SRC).toContain("getServerRuntimeState");
    expect(SRC).toContain("getAuthorizationServerPageBoundary");
    expect(SRC).toContain('surface: "api_resources"');
    expect(SRC).toContain("if (capabilityBoundary)");
    expect(SRC).toContain("<CapabilityUnavailablePanel copy={capabilityBoundary} />");
    expect(SRC.indexOf("if (capabilityBoundary)")).toBeLessThan(
      SRC.indexOf("const result = await getApiResource(id);")
    );
  });

  it("capability boundary wiring preserves API resource hrefs", () => {
    const LIST_SRC = readModule("page.tsx");
    const DETAIL_SRC = readModule("[id]/page.tsx");
    const CREATE_SRC = readModule("new/page.tsx");
    const EDIT_SRC = readModule("[id]/edit/page.tsx");
    expect(LIST_SRC).toContain('href="/org-admin/api-resources/new"');
    expect(DETAIL_SRC).toContain('href="/org-admin/api-resources"');
    expect(DETAIL_SRC).toContain(
      "href={`/org-admin/api-resources/${encodeURIComponent(id)}/edit`}"
    );
    expect(CREATE_SRC).toContain('href="/org-admin/api-resources"');
    expect(EDIT_SRC).toContain("href={`/org-admin/api-resources/${encodeURIComponent(id)}`}");
  });
});

describe("api-resources surface — Recent activity card lives ONLY on [id]/page.tsx (+ helper module)", () => {
  for (const rel of PAGE_FILES_NO_RECENT_ACTIVITY) {
    it(`${rel} does NOT include a Recent activity card`, () => {
      const SRC = readModuleStripped(rel);
      expect(SRC).not.toMatch(/Recent\s+activity/i);
      expect(SRC).not.toMatch(/listAuditEvents\b/);
    });
  }
});

describe("api-resources surface — rotate/regenerate UI lives ONLY in [id]/security-section.tsx", () => {
  for (const rel of PAGE_FILES_NO_ROTATE) {
    it(`${rel} does NOT add rotate/regenerate UI`, () => {
      const SRC = readModuleStripped(rel);
      expect(SRC).not.toMatch(/rotate\s+secret/i);
      expect(SRC).not.toMatch(/regenerate\s+secret/i);
      expect(SRC).not.toMatch(/rotateApiResourceSecret\b/);
      expect(SRC).not.toMatch(/regenerateApiResourceSecret\b/);
    });
  }

  it("[id]/security-section.tsx is the SINGLE rotate-surface (mounted on the detail page)", () => {
    const SRC = readModuleStripped("[id]/security-section.tsx");
    // Has the rotate affordance + the SecuritySection export the page mounts.
    expect(SRC).toMatch(/Rotate API resource secret/);
    expect(SRC).toMatch(/export\s+function\s+SecuritySection\b/);
    expect(SRC).toMatch(/rotateApiResourceSecretAction\b/);
    // No regenerate spelling; the canonical UI name is "Rotate".
    expect(SRC).not.toMatch(/regenerate\s+secret/i);
    // The detail page mounts <SecuritySection ...> exactly once.
    const PAGE_SRC = readModule("[id]/page.tsx");
    expect(PAGE_SRC).toMatch(/import\s*\{\s*SecuritySection\s*\}/);
    expect(PAGE_SRC.match(/<SecuritySection\b/g)?.length ?? 0).toBe(1);
  });
});

describe("delete DangerZone — type-to-confirm pattern is enforced", () => {
  const SRC = readModule("[id]/danger-zone.tsx");
  it("renders a confirmation input and disables submit until typed value matches", () => {
    expect(SRC).toMatch(/Type to confirm/);
    expect(SRC).toMatch(/submitDisabled/);
    expect(SRC).toMatch(
      /matches\s*=\s*trimmed\s*===\s*resourceName\s*\|\|\s*trimmed\s*===\s*resourceAudience/
    );
  });
  it("uses the two-step expand pattern before showing the destructive form", () => {
    expect(SRC).toMatch(/setExpanded\(true\)/);
    expect(SRC).toMatch(/ExpandPanel/);
  });
});

describe("SecuritySection — rotate-secret UI contract", () => {
  const RAW = readModule("[id]/security-section.tsx");
  const SRC = readModuleStripped("[id]/security-section.tsx");

  it("declares 'use client' (the success panel uses useActionState in-memory)", () => {
    expect(RAW.startsWith('"use client"')).toBe(true);
  });

  it("uses the two-step expand pattern (no POST on first click)", () => {
    expect(SRC).toMatch(/setExpanded\(true\)/);
    expect(SRC).toMatch(/ExpandPanel/);
  });

  it("enforces the type-to-confirm matching gate against name OR audience", () => {
    expect(SRC).toMatch(
      /matches\s*=\s*trimmed\s*===\s*resourceName\s*\|\|\s*trimmed\s*===\s*resourceAudience/
    );
    expect(SRC).toMatch(/submitDisabled\s*=\s*!matches/);
  });

  it("renders the copy-once warning verbatim (operator must copy now)", () => {
    expect(RAW).toMatch(/Copy this secret now\. It will not be shown again\./);
  });

  it("renders the existing-token caveat (existing access tokens valid until expiry)", () => {
    expect(RAW).toMatch(
      /Existing access tokens issued for this audience continue to validate at\s+the resource\s+server until they expire\. Future authentication attempts\s+using the old secret will fail\./
    );
  });

  it("the form has ONE input named 'confirm' — no secret-shaped form keys", () => {
    expect(SRC).toMatch(/name="confirm"/);
    expect(SRC).not.toMatch(/name="resource_secret"/);
    expect(SRC).not.toMatch(/name="old_secret"/);
    expect(SRC).not.toMatch(/name="new_secret"/);
    expect(SRC).not.toMatch(/name="secret_hash"/);
    expect(SRC).not.toMatch(/name="organization_id"/);
  });

  it("no console.* call anywhere in the file", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
  });

  it("does NOT write the secret to localStorage / sessionStorage / cookies / URL / history", () => {
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
    expect(SRC).not.toMatch(/window\.history\b/);
    expect(SRC).not.toMatch(/router\.push\b/);
  });

  it("does NOT mirror the secret into useState / useEffect (single useActionState cell only)", () => {
    // Look at the SuccessPanel function body — it must NOT call useState
    // or useEffect.
    const successMatch = SRC.match(/function\s+SuccessPanel[\s\S]*?\n\}/);
    expect(successMatch).not.toBeNull();
    const body = successMatch?.[0] ?? "";
    expect(body).not.toMatch(/useState\b/);
    expect(body).not.toMatch(/useEffect\b/);
  });

  it("does NOT reference any old-secret variable, hash literal, or token-shaped identifier", () => {
    // The phrase "old secret" appears in the SuccessPanel's body copy
    // (caveat about the previous secret no longer authenticating); that
    // is operator-facing prose and is intentional. The negative
    // invariants below pin VARIABLE / IDENTIFIER references rather than
    // phrase substrings.
    expect(SRC).not.toMatch(/\boldSecret\b/);
    expect(SRC).not.toMatch(/\.old_secret\b/);
    expect(SRC).not.toMatch(/resource_secret_hash/);
    expect(SRC).not.toMatch(/secret_hash/);
    expect(SRC).not.toMatch(/private_key/);
    expect(SRC).not.toMatch(/access_token/);
    expect(SRC).not.toMatch(/refresh_token/);
  });
});

describe("create page — surfaces the one-time secret in a copy-once panel only", () => {
  const RAW = readModule("new/create-api-resource-form.tsx");
  const SRC = readModuleStripped("new/create-api-resource-form.tsx");
  it("renders SetupLinkPanel for the one-time secret", () => {
    expect(RAW).toMatch(/SetupLinkPanel/);
    expect(RAW).toMatch(/One-time resource secret/);
  });
  it("does NOT persist the secret to localStorage / sessionStorage / cookies / URL", () => {
    expect(SRC).not.toMatch(/localStorage\b/);
    expect(SRC).not.toMatch(/sessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/window\.location\.search\b/);
    expect(SRC).not.toMatch(/searchParams\.set\b/);
  });
  it("does NOT log the secret", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
  });
});

// ── Recent activity card pins (slice identuum-20260530-org-admin-api-resource-detail-audit-card-ui) ──

describe("api-resource-detail-audit helper — copy + label map + href builder", () => {
  const RAW = readModule("[id]/api-resource-detail-audit.ts");
  const SRC = readModuleStripped("[id]/api-resource-detail-audit.ts");

  it("exports the documented copy constants verbatim", () => {
    expect(RAW).toMatch(/title:\s*"Recent activity"/);
    expect(RAW).toMatch(
      /subtitle:\s*"Latest audit events where this API resource is the subject\."/
    );
    expect(RAW).toMatch(/viewAllLabel:\s*"View all →"/);
    expect(RAW).toMatch(/emptyBody:\s*"No recent activity recorded for this API resource\."/);
    expect(RAW).toMatch(/errorBody:\s*"Could not load recent activity for this API resource\./);
  });

  it("maps every documented event type to a non-technical label", () => {
    const block = RAW.match(/API_RESOURCE_AUDIT_EVENT_LABELS[\s\S]*?\};/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toMatch(/api_resource_created:\s*"API resource created"/);
    expect(body).toMatch(/api_resource_updated:\s*"API resource updated"/);
    expect(body).toMatch(/api_resource_deleted:\s*"API resource deleted"/);
    expect(body).toMatch(/api_resource_secret_rotated:\s*"API resource secret rotated"/);
  });

  it("getApiResourceAuditEventLabel falls back to the raw event_type token on unknown events", () => {
    expect(SRC).toMatch(/return\s+"API resource activity"/);
    expect(SRC).toMatch(/return\s+known\s*\?\?\s*eventType/);
  });

  it("buildOrgAdminApiResourceAuditHref roots at /org-admin/audit and URI-encodes both params", () => {
    expect(SRC).toMatch(/\/org-admin\/audit\?subject_id=\$\{encodeURIComponent\(resourceID\)\}/);
    expect(SRC).toMatch(/&event_type=\$\{encodeURIComponent\(eventType\)\}/);
    expect(SRC).not.toMatch(/\/site-admin\/audit/);
  });

  it("helper module has no console.* / no storage primitive / no raw-metadata references", () => {
    expect(SRC).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(SRC).not.toMatch(/\blocalStorage\b/);
    expect(SRC).not.toMatch(/\bsessionStorage\b/);
    expect(SRC).not.toMatch(/document\.cookie\b/);
    expect(SRC).not.toMatch(/JSON\.stringify/);
    // Word-boundary scan so the event-type literal
    // `api_resource_secret_rotated` (which legitimately contains
    // "resource_secret" as a substring of the event-type token) does
    // not produce a false positive. Each forbidden identifier is
    // anchored as a complete identifier; the helper module legitimately
    // does NOT carry any of these.
    for (const forbidden of [
      "resource_secret_hash",
      "secret_hash",
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
      expect(SRC.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("api-resources detail page — Recent activity card wiring", () => {
  const SRC = readModuleStripped("[id]/page.tsx");

  it("imports helper symbols + listAuditEvents wire helper", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*?listAuditEvents[\s\S]*?\}\s*from\s*"@\/lib\/idp-admin-client"/
    );
    expect(SRC).toMatch(/from\s*"\.\/api-resource-detail-audit"/);
    expect(SRC).toMatch(/API_RESOURCE_RECENT_ACTIVITY_COPY/);
    expect(SRC).toMatch(/buildOrgAdminApiResourceAuditHref/);
    expect(SRC).toMatch(/getApiResourceAuditEventLabel/);
  });

  it("fetches the audit feed in parallel with getApiResource (Promise.all + .catch null fallback)", () => {
    expect(SRC).toMatch(/Promise\.all\(\[[\s\S]*?getApiResource\(id\)/);
    expect(SRC).toMatch(/listAuditEvents\(\{[\s\S]*?subjectId:\s*id[\s\S]*?\}\)/);
    expect(SRC).toMatch(/subjectType:\s*"api_resource"/);
    expect(SRC).toMatch(/pageSize:\s*5/);
    expect(SRC).toMatch(/\.catch\(\(\):\s*ListAuditEventsResult\s*\|\s*null\s*=>\s*null\)/);
  });

  it("call site does NOT pass organization-shaped or actor-shaped params (server-enforces tenant scope)", () => {
    const fetchBlock = SRC.match(/listAuditEvents\(\{[\s\S]*?\}\)/);
    expect(fetchBlock).not.toBeNull();
    const body = fetchBlock?.[0] ?? "";
    expect(body).not.toMatch(/organization_id/);
    expect(body).not.toMatch(/organizationId/);
    expect(body).not.toMatch(/actor_organization_id/);
    expect(body).not.toMatch(/actorOrgId/);
    expect(body).not.toMatch(/orgId/);
  });

  it("mounts <APIResourceRecentActivity> exactly once, between SecuritySection and DangerZone", () => {
    expect(SRC.match(/<APIResourceRecentActivity\b/g)?.length ?? 0).toBe(1);
    const securityIdx = SRC.indexOf("<SecuritySection");
    const recentIdx = SRC.indexOf("<APIResourceRecentActivity");
    const dangerIdx = SRC.indexOf("<DangerZone");
    expect(securityIdx).toBeGreaterThan(0);
    expect(recentIdx).toBeGreaterThan(0);
    expect(dangerIdx).toBeGreaterThan(0);
    expect(securityIdx).toBeLessThan(recentIdx);
    expect(recentIdx).toBeLessThan(dangerIdx);
  });

  it("APIResourceRecentActivityRow renders ONLY safe compact fields (no raw metadata / IP / user-agent / secrets)", () => {
    // The compact row's JSX body is the rendered content of the
    // APIResourceRecentActivityRow function. The row function returns
    // a single <li>...</li> JSX expression; locate the function body
    // up to the matching </li>); + closing brace.
    const rowStart = SRC.indexOf("function APIResourceRecentActivityRow");
    expect(rowStart).toBeGreaterThan(0);
    const rowEnd = SRC.indexOf(
      "\n}\n",
      rowStart + "function APIResourceRecentActivityRow".length + 200
    );
    expect(rowEnd).toBeGreaterThan(rowStart);
    const body = SRC.slice(rowStart, rowEnd);
    for (const forbidden of [
      "ip_address",
      "user_agent",
      "JSON.stringify",
      "event.metadata",
      ".metadata)",
      "resource_secret",
      "resource_secret_hash",
      "secret_hash",
      "client_secret",
      "private_key",
      "signing_key",
      "access_token",
      "refresh_token",
      "authorization_code",
      "bearer",
      "set-cookie",
      "session_id",
      "AuditIPAddressCell",
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // The row MUST render the safe fields (label / event_type token /
    // optional actor / timestamp). AUDIT-DETAILS-1 removed the invented
    // `summary` (the OSS wire never carried it), so it is no longer asserted.
    expect(body).toMatch(/getApiResourceAuditEventLabel/);
    expect(body).toMatch(/event\.event_type/);
    expect(body).toMatch(/event\.actor_email/);
    expect(body).toMatch(/event\.actor_type/);
    expect(body).toMatch(/<LocalTime value=\{event\.created_at\}/);
  });

  it("per-row href shape = /org-admin/audit?subject_id=<id>&event_type=<type> (the helper does both)", () => {
    expect(SRC).toMatch(/buildOrgAdminApiResourceAuditHref\(resourceID,\s*event\.event_type\)/);
  });

  it("View-all link omits event_type and uses the same helper", () => {
    expect(SRC).toMatch(/buildOrgAdminApiResourceAuditHref\(resourceID\)/);
  });

  it("per-row accessible name names the destination so screen readers know where the click goes", () => {
    expect(SRC).toMatch(/`View audit event \$\{event\.event_type\} for this API resource`/);
  });

  it("no mutation control was added to the detail page outside the existing Security/DangerZone surfaces", () => {
    // The new card is an <a>-only / read-only surface; no <form> /
    // useActionState / useState belongs in the page module itself.
    expect(SRC).not.toMatch(/useActionState/);
    expect(SRC).not.toMatch(/use client/);
  });
});
