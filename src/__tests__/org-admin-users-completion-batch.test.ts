/**
 * Pins for the org-admin Users completion batch.
 *
 *   - parseBulkInviteEntries  → row-by-row parsing of the bulk-invite textarea.
 *   - Wire-helper presence    → bulkCreateUsers / getBulkJobStatus /
 *                                approveUserRegistration / listUserRoles /
 *                                assignUserRole / removeUserRole are exported
 *                                from src/lib/idp-admin-client.ts.
 *   - Security invariants     → getBulkJobStatus projects activation_token
 *                                into a server-built setup_url and NEVER
 *                                exposes the raw token on its public type.
 *   - Server-action presence  → bulkInviteUsersAction / refreshBulkJobAction
 *                                / approveRegistrationAction /
 *                                assignUserRoleAction / removeUserRoleAction
 *                                exist on the users actions module.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBulkInviteEntries } from "../app/org-admin/users/bulk-invite-parser";

// ── parseBulkInviteEntries — behavioural pins ───────────────────────────────

describe("parseBulkInviteEntries — accepts CSV", () => {
  it("parses a single comma-separated row", () => {
    const r = parseBulkInviteEntries("alice@example.com,Alice");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toEqual([{ email: "alice@example.com", name: "Alice" }]);
    }
  });

  it("lowercases and trims the email; trims (but does not lowercase) the name", () => {
    const r = parseBulkInviteEntries("   ALICE@Example.COM  ,  Alice Smith   ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries[0].email).toBe("alice@example.com");
      expect(r.entries[0].name).toBe("Alice Smith");
    }
  });

  it("accepts tab-separated rows", () => {
    const r = parseBulkInviteEntries("alice@example.com\tAlice");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toEqual([{ email: "alice@example.com", name: "Alice" }]);
    }
  });

  it("skips blank lines", () => {
    const r = parseBulkInviteEntries("alice@example.com,Alice\n\n\nbob@example.com,Bob\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toHaveLength(2);
    }
  });
});

describe("parseBulkInviteEntries — rejects malformed input", () => {
  it("rejects an empty input", () => {
    const r = parseBulkInviteEntries("");
    expect(r.ok).toBe(false);
  });

  it("rejects an email-only row (missing name)", () => {
    const r = parseBulkInviteEntries("alice@example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Line 1/);
    }
  });

  it("rejects a row with a blank name after the separator", () => {
    const r = parseBulkInviteEntries("alice@example.com,");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/display name is required/i);
    }
  });

  it("rejects a row with an obviously invalid email shape", () => {
    const r = parseBulkInviteEntries("not-an-email,Alice");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/invalid email/i);
    }
  });

  it("rejects more than 50 rows", () => {
    const rows = Array.from({ length: 51 }, (_, i) => `member${i}@example.com,Member ${i}`).join(
      "\n"
    );
    const r = parseBulkInviteEntries(rows);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/maximum 50/i);
    }
  });

  it("reports the failing line number (1-indexed)", () => {
    const r = parseBulkInviteEntries("alice@example.com,Alice\nbob@example.com,Bob\nbroken-row\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Line 3/);
    }
  });
});

// ── Wire-helper presence + security pins (source-level) ─────────────────────

const CLIENT_SRC = (() => {
  const p = resolve(__dirname, "..", "lib", "idp-admin-client.ts");
  return readFileSync(p, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
})();

describe("idp-admin-client.ts — wire-helper exports for the Users batch", () => {
  it("exports bulkCreateUsers", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+bulkCreateUsers\b/);
  });
  it("exports getBulkJobStatus", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+getBulkJobStatus\b/);
  });
  it("exports approveUserRegistration", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+approveUserRegistration\b/);
  });
  it("exports listUserRoles", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+listUserRoles\b/);
  });
  it("exports assignUserRole", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+assignUserRole\b/);
  });
  it("exports removeUserRole", () => {
    expect(CLIENT_SRC).toMatch(/export\s+async\s+function\s+removeUserRole\b/);
  });
});

describe("idp-admin-client.ts — security invariants for bulk job projection", () => {
  it("BulkJobResultItem exposes setup_url, NOT activation_token", () => {
    // The public type surfaces the projected URL. The raw token must not
    // appear as a public field shape.
    expect(CLIENT_SRC).toMatch(/BulkJobResultItem[\s\S]*?setup_url:\s*string\s*\|\s*null/);
    expect(CLIENT_SRC).not.toMatch(/BulkJobResultItem[\s\S]*?activation_token:/);
  });

  it("buildSetupURL trims trailing slash on the ui_origin", () => {
    expect(CLIENT_SRC).toMatch(/trimTrailingSlash\(uiOrigin\)/);
  });

  it("buildSetupURL URL-encodes the token", () => {
    expect(CLIENT_SRC).toMatch(/encodeURIComponent\(token\)/);
  });

  it("buildSetupURL returns null when ui_origin is missing", () => {
    // Belt-and-braces: a deployment without ui_origin must not silently
    // synthesize a relative URL or absolute "undefined/setup?token=...".
    expect(CLIENT_SRC).toMatch(
      /if\s*\(!uiOrigin\s*\|\|\s*uiOrigin\.length\s*===\s*0\)\s*return\s+null/
    );
  });
});

// ── Server-action presence pins ─────────────────────────────────────────────

const ACTIONS_SRC = (() => {
  const p = resolve(__dirname, "..", "app", "org-admin", "users", "actions.ts");
  return readFileSync(p, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
})();

describe("users/actions.ts — server actions for the Users batch", () => {
  it("exports bulkInviteUsersAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+bulkInviteUsersAction\b/);
  });
  it("exports refreshBulkJobAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+refreshBulkJobAction\b/);
  });
  it("exports approveRegistrationAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+approveRegistrationAction\b/);
  });
  it("exports assignUserRoleAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+assignUserRoleAction\b/);
  });
  it("exports removeUserRoleAction", () => {
    expect(ACTIONS_SRC).toMatch(/export\s+async\s+function\s+removeUserRoleAction\b/);
  });

  it("every mutating action re-validates the session and role before calling the wire", () => {
    // The pattern mirrored from setUserActiveAction. A regression that
    // dropped the redirect on missing session would surface here.
    expect(
      (ACTIONS_SRC.match(/await\s+getServerSession\s*\(\)/g) ?? []).length
    ).toBeGreaterThanOrEqual(5);
    expect((ACTIONS_SRC.match(/role\s*!==\s*"org_admin"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
