/**
 * Tests for the /org-admin/settings Domains card (slice 1).
 *
 * Scope discipline (mirrors the prior helper-extraction tasks):
 *   - `domains-card.tsx` is a `"use client"` React component using
 *     `useActionState`; vitest runs in `environment: "node"` without
 *     `jsdom`/`happy-dom`/`@testing-library/react`. Rendered-DOM
 *     coverage lives in `e2e/org-admin-settings.spec.ts`.
 *   - These tests pin the operator-facing copy, the source-text
 *     invariants the security contract relies on (token never persisted,
 *     no `verification_token_hash` in any list code path), the client
 *     method paths/methods/payloads, and the server-action contract
 *     (org id derived server-side; never read from form).
 *
 * SECURITY:
 *   - No HTTP call, no organization mutation, no DB read. All
 *     assertions are against pure helpers + source text + type shapes.
 *   - The negative invariants block `verification_token_hash`,
 *     `record_value` as a stored field, the `token` (raw) on any list
 *     code path, and authority-boundary copy ("site_admin", "cross-org",
 *     etc.).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ADMIN_DOMAINS_CARD_COPY } from "../app/org-admin/settings/settings-helpers";

// ── Copy bundle ──────────────────────────────────────────────────────────────

describe("ORG_ADMIN_DOMAINS_CARD_COPY — operator copy pins", () => {
  it("cardTitle is exactly 'Domains'", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.cardTitle).toBe("Domains");
  });

  it("cardSubtitle scopes to 'your organization' (no cross-org or site-admin language)", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.cardSubtitle).toMatch(/your organization/i);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.cardSubtitle).not.toMatch(/\bsite[- ]admin\b/i);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.cardSubtitle).not.toMatch(/\bcross[- ]org\b/i);
  });

  it("challengeShownOnce tells the operator the TXT value is surfaced once", () => {
    // Load-bearing safety copy. A regression that softened "not be
    // shown again" into "shown until you reload" would mislead the
    // operator into thinking they can come back for it later.
    const copy = ORG_ADMIN_DOMAINS_CARD_COPY.challengeShownOnce;
    expect(copy).toMatch(/not be shown again/i);
    expect(copy).toMatch(/copy/i);
  });

  it("challenge field labels cover record_name, record_type, record_value, expires_at", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordNameLabel).toBe("Record name");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordTypeLabel).toBe("Record type");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordValueLabel).toBe("Record value");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.challengeExpiresAtLabel).toBe("Expires at");
  });

  it("per-row badges and buttons use distinct operator strings", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.primaryBadge).toBe("Primary");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifiedBadge).toBe("Verified");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.pendingBadge).toBe("Pending");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyButton).toBe("Verify");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.setPrimaryButton).toBe("Set primary");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeButton).toBe("Remove");
  });

  it("addLabel is a real, accessible label (not just placeholder text)", () => {
    // Accessibility: the add-domain input MUST have a real label so
    // screen readers and Playwright's getByLabel work. The placeholder
    // alone is not a substitute.
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.addLabel).toBe("Add a domain");
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.addLabel.length).toBeGreaterThan(0);
  });

  it("no copy string contains credential-material / hash / token-internal language", () => {
    const ALL = Object.values(ORG_ADMIN_DOMAINS_CARD_COPY);
    const BANNED = [
      /verification_token_hash/i,
      /token_hash/i,
      /password_hash/i,
      /mfa_secret/i,
      /\bclaim_token\b/i,
      /Set-Cookie/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /otpauth:\/\//i,
    ];
    for (const s of ALL) {
      for (const pat of BANNED) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Client method source contract ────────────────────────────────────────────
//
// We don't execute the client methods in node here — they require a
// runtime config + cookies(). Instead we pin the contract by reading the
// source text: the endpoint paths, the HTTP methods, the strict-body
// invariant on add-domain, and the strict no-`verification_token_hash`
// invariant in every sanitizer code path.

describe("idp-admin-client.ts — Org-admin Domains source contract", () => {
  const CLIENT_SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  it("declares the five Domains methods with the documented names", () => {
    expect(CLIENT_SRC).toMatch(/export async function listOrganizationDomains\b/);
    expect(CLIENT_SRC).toMatch(/export async function addOrganizationDomain\b/);
    expect(CLIENT_SRC).toMatch(/export async function verifyOrganizationDomain\b/);
    expect(CLIENT_SRC).toMatch(/export async function deleteOrganizationDomain\b/);
    expect(CLIENT_SRC).toMatch(/export async function setPrimaryOrganizationDomain\b/);
  });

  it("listOrganizationDomains GETs /api/v1/organizations/:id/domains", () => {
    expect(CLIENT_SRC).toMatch(
      /listOrganizationDomains[\s\S]*?\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/domains[\s\S]*?method:\s*"GET"/
    );
  });

  it("addOrganizationDomain POSTs to /api/v1/organizations/:id/domains with strict body { domain }", () => {
    expect(CLIENT_SRC).toMatch(
      /addOrganizationDomain[\s\S]*?\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/domains[\s\S]*?method:\s*"POST"/
    );
    // The body MUST be the typed literal `{ domain: ... }`. A regression
    // that broadened the body to `Record<string, unknown>` or that
    // started reading an `organization_id` field would surface here.
    expect(CLIENT_SRC).toMatch(/const\s+body:\s*\{\s*domain:\s*string\s*\}\s*=\s*\{\s*domain:/);
    // Negative: the add-domain helper MUST NOT include organization_id
    // in the body. The path carries the org id; the body does not.
    const addBlock = CLIENT_SRC.split("export async function addOrganizationDomain")[1] ?? "";
    const untilNextExport = addBlock.split("export ")[0] ?? "";
    expect(untilNextExport).not.toMatch(/body\.organization_id/);
    expect(untilNextExport).not.toMatch(/organization_id\s*:/);
  });

  it("verifyOrganizationDomain POSTs to /api/v1/organizations/:id/domains/:domain_id/verify", () => {
    expect(CLIENT_SRC).toMatch(
      /verifyOrganizationDomain[\s\S]*?\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/domains\/\$\{encodeURIComponent\(domainID\)\}\/verify[\s\S]*?method:\s*"POST"/
    );
  });

  it("deleteOrganizationDomain DELETEs /api/v1/organizations/:id/domains/:domain_id", () => {
    expect(CLIENT_SRC).toMatch(
      /deleteOrganizationDomain[\s\S]*?\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/domains\/\$\{encodeURIComponent\(domainID\)\}[\s\S]*?method:\s*"DELETE"/
    );
  });

  it("setPrimaryOrganizationDomain POSTs to /api/v1/organizations/:id/domains/:domain_id/primary", () => {
    expect(CLIENT_SRC).toMatch(
      /setPrimaryOrganizationDomain[\s\S]*?\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/domains\/\$\{encodeURIComponent\(domainID\)\}\/primary[\s\S]*?method:\s*"POST"/
    );
  });

  it("the sanitizer NEVER reads verification_token_hash from the wire (post-comment-strip)", () => {
    // The IDP omits the field; the UI also must not start carrying it.
    // We strip comments first so that doc-blocks that legitimately
    // mention the field (as a documented exclusion) don't trip the
    // assertion. A regression that copied the hash through code paths
    // would still surface here.
    const noComments = CLIENT_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/verification_token_hash/);
    expect(noComments).not.toMatch(/token_hash/);
  });
});

// ── types.ts shape contract ──────────────────────────────────────────────────
//
// Pin the wire types exposed to the rest of the UI. The list type MUST
// NOT carry the verification token hash — a TS regression that added
// the field would break the type, and the sanitizer above would also
// need to start copying it (which the source contract test blocks).

describe("types.ts — OrganizationDomain* shape contract", () => {
  const TYPES_SRC = readFileSync(resolve(__dirname, "..", "lib", "types.ts"), "utf-8");

  it("declares the documented seven Domain types", () => {
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainInfo\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainChallenge\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainListResponse\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainResponse\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainChallengeResponse\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainDeleteResponse\b/);
    expect(TYPES_SRC).toMatch(/export interface OrganizationDomainSetPrimaryResponse\b/);
  });

  it("OrganizationDomainInfo does NOT include verification_token_hash", () => {
    const start = TYPES_SRC.indexOf("export interface OrganizationDomainInfo");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = TYPES_SRC.indexOf("}", start);
    const block = TYPES_SRC.slice(start, end);
    expect(block).not.toMatch(/verification_token_hash/);
    expect(block).not.toMatch(/token_hash/);
  });
});

// ── Server-action contract ──────────────────────────────────────────────────

describe("domains-actions.ts — server-action contract", () => {
  const ACTIONS_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "domains-actions.ts"),
    "utf-8"
  );

  it("declares the four documented actions", () => {
    expect(ACTIONS_SRC).toMatch(/export async function addOrganizationDomainAction\b/);
    expect(ACTIONS_SRC).toMatch(/export async function verifyOrganizationDomainAction\b/);
    expect(ACTIONS_SRC).toMatch(/export async function deleteOrganizationDomainAction\b/);
    expect(ACTIONS_SRC).toMatch(/export async function setPrimaryOrganizationDomainAction\b/);
  });

  it("every action derives the org ID via getOwnOrganization (NEVER from form data)", () => {
    // The org id is session-derived. A regression that started reading
    // it from formData would surface here.
    expect(ACTIONS_SRC).toMatch(/getOwnOrganization\(\)/);
    expect(ACTIONS_SRC).not.toMatch(/formData\.get\(\s*["']organization_id["']\s*\)/);
    expect(ACTIONS_SRC).not.toMatch(/formData\.get\(\s*["']org_id["']\s*\)/);
  });

  it("every action re-validates the session and the org_admin role", () => {
    // Belt-and-suspenders beyond the /org-admin layout guard. A
    // regression that dropped the guard from one action would surface
    // here.
    const occurrences = (s: string, pat: RegExp) => (s.match(pat) || []).length;
    expect(occurrences(ACTIONS_SRC, /getServerSession\(\)/g)).toBeGreaterThanOrEqual(4);
    expect(occurrences(ACTIONS_SRC, /role\s*!==\s*"org_admin"/g)).toBeGreaterThanOrEqual(4);
  });

  it("addOrganizationDomainAction returns the challenge ONLY from the add response", () => {
    // The success state shape includes record_name/type/value/expires_at
    // — the only path into that envelope is the add helper's response.
    // The raw `token` field on the wire is intentionally NOT forwarded
    // separately to the UI (record_value is the operator-publishable
    // form). The action MUST NOT include `token:` in the state envelope.
    expect(ACTIONS_SRC).toMatch(
      /phase:\s*"success"[\s\S]*?record_name:[\s\S]*?record_value:[\s\S]*?expires_at:/
    );
    const addBlock =
      ACTIONS_SRC.split("export async function addOrganizationDomainAction")[1] ?? "";
    const untilNext = addBlock.split("// ──")[0] ?? "";
    expect(untilNext).not.toMatch(/\btoken\s*:/);
  });

  it("every action calls revalidatePath('/org-admin/settings') after mutations", () => {
    const occurrences = (s: string, pat: RegExp) => (s.match(pat) || []).length;
    expect(
      occurrences(ACTIONS_SRC, /revalidatePath\("\/org-admin\/settings"\)/g)
    ).toBeGreaterThanOrEqual(4);
  });
});

// ── Component source contract ──────────────────────────────────────────────

describe("DomainsCard — source contract", () => {
  const CARD_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "domains-card.tsx"),
    "utf-8"
  );

  it("is a 'use client' component that imports the four actions", () => {
    expect(CARD_SRC).toMatch(/^"use client";/);
    expect(CARD_SRC).toMatch(/addOrganizationDomainAction/);
    expect(CARD_SRC).toMatch(/verifyOrganizationDomainAction/);
    expect(CARD_SRC).toMatch(/deleteOrganizationDomainAction/);
    expect(CARD_SRC).toMatch(/setPrimaryOrganizationDomainAction/);
  });

  it("renders a real <label htmlFor> for the add-domain input (a11y)", () => {
    expect(CARD_SRC).toMatch(
      /<label\s+htmlFor="org-admin-add-domain"[\s\S]*?>\s*\{\s*ORG_ADMIN_DOMAINS_CARD_COPY\.addLabel\s*\}/
    );
    expect(CARD_SRC).toMatch(/<input[\s\S]*?id="org-admin-add-domain"[\s\S]*?name="domain"/);
  });

  it("the Remove control is gated by !d.is_primary (primary domain has NO Remove affordance)", () => {
    // The Remove form must appear inside a `{!d.is_primary && (...)}` block.
    expect(CARD_SRC).toMatch(/\{!d\.is_primary && \(\s*<form[\s\S]*?removeButton/);
    // Brute-force negative: the substring `removeButton` MUST appear
    // only once in the source. Two occurrences would mean an
    // unconditional Remove form was added in addition to the gated one.
    const occurrences = (CARD_SRC.match(/removeButton/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("the Verify control is gated by !d.verified (verified rows do NOT show Verify)", () => {
    expect(CARD_SRC).toMatch(/\{!d\.verified && \(\s*<form[\s\S]*?verifyButton/);
  });

  it("the Set primary control is gated by d.verified && !d.is_primary", () => {
    expect(CARD_SRC).toMatch(
      /\{d\.verified && !d\.is_primary && \(\s*<form[\s\S]*?setPrimaryButton/
    );
  });

  it("renders the challenge envelope only when addState.phase === 'success'", () => {
    // The DNS-TXT challenge value MUST surface ONLY on the immediate
    // success state. A regression that started reading record_value
    // from any other source (props, localStorage, server fetch) would
    // surface here.
    expect(CARD_SRC).toMatch(
      /\{\s*addState\.phase\s*===\s*"success"\s*&&[\s\S]*?addState\.challenge\.record_value/
    );
    // The component MUST NOT carry the challenge across renders via
    // any storage primitive.
    expect(CARD_SRC).not.toMatch(/localStorage/);
    expect(CARD_SRC).not.toMatch(/sessionStorage/);
    // And MUST NOT log it.
    expect(CARD_SRC).not.toMatch(/console\.\w+/);
  });

  it("never names or renders verification_token_hash on any code path", () => {
    expect(CARD_SRC).not.toMatch(/verification_token_hash/);
    expect(CARD_SRC).not.toMatch(/token_hash/);
  });
});

// ── Page wiring ─────────────────────────────────────────────────────────────

// ── Verify-failure UX (slice 2) ─────────────────────────────────────────────
//
// The verify server action maps the IDP's discriminated error surface to
// four operator-safe copy strings on ORG_ADMIN_DOMAINS_CARD_COPY. The
// invariants pinned here:
//
//   1. The four copy keys exist and read as actionable operator guidance.
//   2. NONE of them name the DNS challenge record_value, the raw token,
//      a token hash, cookies, or a backend stack/error code.
//   3. The action source MUST reference each of the four copy keys (so a
//      regression that re-inlined a backend message would surface).
//   4. The action's error envelope on the verify path MUST NOT carry the
//      challenge, the record_value, the token, or any hash through to the
//      UI — the wire type already excludes them, this is a source pin so
//      a future regression that started forwarding them would be caught.
//   5. The DomainsCard renders verifyState.error verbatim with no
//      concatenation with challenge / token / record_value substrings —
//      a regression that echoed the challenge into the verify-failure
//      banner would surface here.
//   6. The verify button source-pin (already covered above as a generic
//      gate) is restated as a slice-2 invariant: pending rows are the
//      ONLY source of the Verify affordance, so a verify-failure render
//      cannot accidentally hide the row in the UI.

describe("ORG_ADMIN_DOMAINS_CARD_COPY — verify-failure copy bundle (slice 2)", () => {
  it("declares the four verifyError* keys with non-empty operator copy", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorRecordNotFound.length).toBeGreaterThan(0);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorMismatch.length).toBeGreaterThan(0);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorLookupFailed.length).toBeGreaterThan(0);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorGeneric.length).toBeGreaterThan(0);
  });

  it("verifyErrorRecordNotFound names the missing-record condition", () => {
    // Load-bearing actionable copy: the operator must understand that
    // publishing the record is the next step.
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorRecordNotFound).toMatch(/not\s+found/i);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorRecordNotFound).toMatch(/publish/i);
  });

  it("verifyErrorMismatch names the mismatched-value condition", () => {
    // Load-bearing actionable copy: the operator must understand that
    // re-publishing the correct value is the next step.
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorMismatch).toMatch(/does\s+not\s+match/i);
  });

  it("verifyErrorLookupFailed describes the resolver / network failure", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorLookupFailed).toMatch(/dns\s+lookup/i);
  });

  it("verifyErrorGeneric is a safe fallback that hides the backend message", () => {
    // Generic copy must not promise diagnostics — the role of this string
    // is to keep the operator unblocked without leaking server-internal
    // detail.
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorGeneric).toMatch(/try\s+again/i);
  });

  it("NONE of the verifyError* strings name the challenge value, token, hash, or internal cookie/header", () => {
    // The single most load-bearing slice-2 negative invariant: a
    // regression that helpfully echoed "the value was X but should have
    // been Y" into the verify-failure banner would leak the challenge
    // value into the rendered DOM and into any error screenshot.
    const VERIFY_ERROR_STRINGS = [
      ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorRecordNotFound,
      ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorMismatch,
      ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorLookupFailed,
      ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorGeneric,
    ];
    const BANNED: RegExp[] = [
      /record_value/i,
      /\btoken\b/i,
      /token_hash/i,
      /verification_token_hash/i,
      /hash\b/i,
      /Set-Cookie/i,
      /\bcookie\b/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /\bidentuum-challenge=/i,
      /_identuum-challenge\./i,
      /\bstack\b/i,
      /\bdebug\b/i,
    ];
    for (const s of VERIFY_ERROR_STRINGS) {
      for (const pat of BANNED) {
        expect(s, `verify-error copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

describe("verifyOrganizationDomainAction — safe error mapping (slice 2)", () => {
  const ACTIONS_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "domains-actions.ts"),
    "utf-8"
  );

  it("imports ORG_ADMIN_DOMAINS_CARD_COPY (so the bundle is the only source of operator copy)", () => {
    expect(ACTIONS_SRC).toMatch(
      /import\s*\{\s*ORG_ADMIN_DOMAINS_CARD_COPY\s*\}\s*from\s+["']\.\/settings-helpers["']/
    );
  });

  it("verify action references each of the four verifyError* copy keys exactly once", () => {
    // Pin the 1:1 mapping between IDP error kinds and operator-facing
    // copy. A regression that started inlining a string ("DNS lookup
    // failed: ECONNREFUSED to 8.8.8.8") would either drop one of these
    // references or duplicate it — both surface here.
    const verifyBlockSplit = ACTIONS_SRC.split(
      "export async function verifyOrganizationDomainAction"
    );
    expect(verifyBlockSplit.length).toBe(2);
    const verifyTail = verifyBlockSplit[1] ?? "";
    const verifyBody = verifyTail.split("// ── Delete domain")[0] ?? verifyTail;
    expect(
      (verifyBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.verifyErrorRecordNotFound/g) || []).length
    ).toBe(1);
    expect(
      (verifyBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.verifyErrorMismatch/g) || []).length
    ).toBe(1);
    expect(
      (verifyBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.verifyErrorLookupFailed/g) || []).length
    ).toBe(1);
    expect(
      (verifyBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.verifyErrorGeneric/g) || []).length
    ).toBe(1);
  });

  it("verify action error envelope never carries challenge / record_value / token / hash through to the UI", () => {
    // The discriminated state shape on the action only declares
    // { phase: "error"; error: string }. This is a defense-in-depth pin
    // that the error path body never reads a challenge or token field
    // from the wire and never echoes one of those substrings into the
    // returned state.
    const verifyBlockSplit = ACTIONS_SRC.split(
      "export async function verifyOrganizationDomainAction"
    );
    const verifyTail = verifyBlockSplit[1] ?? "";
    const verifyBody = verifyTail.split("// ── Delete domain")[0] ?? verifyTail;
    expect(verifyBody).not.toMatch(/result\.data\.challenge/);
    expect(verifyBody).not.toMatch(/record_value/);
    // The successful response path returns `result.data.domain.domain`
    // — a domain string, never a token. Pin that the error path does
    // NOT read .token or .challenge from the result.
    expect(verifyBody).not.toMatch(/result\.\w*token\b/i);
    expect(verifyBody).not.toMatch(/result\.\w*hash\b/i);
  });
});

// ── Verify error_kind integration with the helper module (slice 4) ────────
//
// classifyDomainVerifyErrorKind owns the kind-to-classification mapping
// and has its own behavioural test file (domain-verification-errors.test.ts).
// The invariants pinned here are the integration contract between
// verifyOrganizationDomain and that helper — plus the load-bearing
// negative invariants that protect against re-introducing substring
// parsing of the human-facing IDP message text.

describe("idp-admin-client.verifyOrganizationDomain — helper integration (slice 4)", () => {
  const CLIENT_SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

  // Helper: slice the verify body out of the source so the negative
  // substring assertions cannot accidentally match an unrelated
  // section of the file (e.g. a comment in another method).
  const verifyBlock = (() => {
    const start = CLIENT_SRC.indexOf("export async function verifyOrganizationDomain");
    expect(start).toBeGreaterThanOrEqual(0);
    const tail = CLIENT_SRC.slice(start);
    const nextExport = tail
      .slice("export async function verifyOrganizationDomain".length)
      .indexOf("\nexport ");
    return nextExport >= 0
      ? tail.slice(0, "export async function verifyOrganizationDomain".length + nextExport)
      : tail;
  })();

  it("imports classifyDomainVerifyErrorKind from the helper module", () => {
    // The integration contract: verifyOrganizationDomain MUST delegate
    // to the pure helper. A regression that re-inlined the switch
    // would drop this import line and surface here.
    expect(CLIENT_SRC).toMatch(
      /import\s*\{\s*classifyDomainVerifyErrorKind\s*\}\s*from\s+["']\.\/domain-verification-errors["']/
    );
  });

  it("calls classifyDomainVerifyErrorKind with the body's error_kind field", () => {
    // The helper is the only classifier. The client passes the raw
    // unknown-typed field directly — the helper handles narrowing.
    expect(verifyBlock).toMatch(/classifyDomainVerifyErrorKind\(\s*body\?\.error_kind\s*\)/);
  });

  it("branches on classification.kind for the four documented outcomes", () => {
    // The result of the helper is a discriminated union with four
    // arms: lookup_failed, record_not_found, mismatch, generic. The
    // verify body must surface each one.
    expect(verifyBlock).toMatch(/case\s+"lookup_failed"\s*:/);
    expect(verifyBlock).toMatch(/case\s+"record_not_found"\s*:/);
    expect(verifyBlock).toMatch(/case\s+"mismatch"\s*:/);
    expect(verifyBlock).toMatch(/case\s+"generic"\s*:/);
  });

  it("has REMOVED the brittle message-substring parsing", () => {
    // Load-bearing negative invariant. msg.includes("not found") /
    // msg.includes("does not match") were the slice-2-flagged gap.
    expect(CLIENT_SRC).not.toMatch(/msg\.includes\(\s*["']not\s+found["']\s*\)/i);
    expect(CLIENT_SRC).not.toMatch(/msg\.includes\(\s*["']does\s+not\s+match["']\s*\)/i);
    // Belt-and-suspenders: the verify body must not read the human
    // message text and must not call msg.includes at all.
    expect(verifyBlock).not.toMatch(/msg\.includes/);
    expect(verifyBlock).not.toMatch(/body\?\.message/);
    // The four wire-kind literals MUST live in the helper module, not
    // in the client. A regression that re-inlined them here would
    // surface — clients should only know about the *classification*
    // outputs ("lookup_failed", "record_not_found", "mismatch",
    // "generic") and never the raw wire kinds.
    expect(verifyBlock).not.toMatch(/"verifier_unavailable"/);
  });

  it("the generic branch sets no discriminator (safe-fallback)", () => {
    // Find the switch over classification.kind and isolate the
    // generic arm. It must not set any of the three discriminators.
    const switchBlock = verifyBlock.match(/switch\s*\(\s*classification\.kind\s*\)[\s\S]*?\}\s*\}/);
    expect(switchBlock).not.toBeNull();
    const block = switchBlock?.[0] ?? "";
    const genericIdx = block.indexOf('case "generic"');
    expect(genericIdx).toBeGreaterThanOrEqual(0);
    // Take from the generic case up to the next case/break/close.
    const genericTail = block.slice(genericIdx);
    const nextCase = genericTail.search(/(case\s+"[a-z_]+"\s*:|\}\s*$)/);
    const genericBody = nextCase >= 0 ? genericTail.slice(0, nextCase) : genericTail;
    expect(genericBody).not.toMatch(/lookupFailed\s*=\s*true/);
    expect(genericBody).not.toMatch(/recordNotFound\s*=\s*true/);
    expect(genericBody).not.toMatch(/mismatch\s*=\s*true/);
  });

  it("a JSON parse failure does not promote any outcome to a classified discriminator", () => {
    // The catch block must keep all three discriminators at their
    // initial `false` — same effect as the helper's "generic" arm.
    const catchMatch = verifyBlock.match(/}\s*catch\s*\{[\s\S]*?\}/);
    expect(catchMatch).not.toBeNull();
    const catchBlock = catchMatch?.[0] ?? "";
    expect(catchBlock).not.toMatch(/lookupFailed\s*=\s*true/);
    expect(catchBlock).not.toMatch(/recordNotFound\s*=\s*true/);
    expect(catchBlock).not.toMatch(/mismatch\s*=\s*true/);
  });
});

describe("domain-verification-errors.ts — helper source contract", () => {
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "lib", "domain-verification-errors.ts"),
    "utf-8"
  );

  it("declares the documented four wire-kind literals", () => {
    // Source pin: the wire allow-list lives here, not in the client.
    // Behavioural coverage is in domain-verification-errors.test.ts.
    expect(HELPER_SRC).toMatch(/"verifier_unavailable"/);
    expect(HELPER_SRC).toMatch(/"lookup_failed"/);
    expect(HELPER_SRC).toMatch(/"record_not_found"/);
    expect(HELPER_SRC).toMatch(/"mismatch"/);
  });

  it("exports the classifier and its public types", () => {
    expect(HELPER_SRC).toMatch(/export type DomainVerifyErrorKind\b/);
    expect(HELPER_SRC).toMatch(/export type DomainVerifyFailureClassification\b/);
    expect(HELPER_SRC).toMatch(/export function classifyDomainVerifyErrorKind\b/);
  });

  it("is pure: no fetch / cookies / fs / logger imports, no I/O", () => {
    // The helper must remain importable from any environment —
    // including vitest node-mode without a runtime config or
    // cookies(). A regression that added side effects would surface
    // here.
    expect(HELPER_SRC).not.toMatch(/from\s+["']next\/headers["']/);
    expect(HELPER_SRC).not.toMatch(/from\s+["']server-only["']/);
    expect(HELPER_SRC).not.toMatch(/\bfetch\(/);
    expect(HELPER_SRC).not.toMatch(/\bconsole\./);
    expect(HELPER_SRC).not.toMatch(/from\s+["']node:/);
    // And does not inspect any "message" field — the helper is
    // wire-kind-only.
    expect(HELPER_SRC).not.toMatch(/\.message\b/);
    expect(HELPER_SRC).not.toMatch(/msg\.includes/);
  });
});

describe("DomainsCard — verify-failure rendering (slice 2)", () => {
  const CARD_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "domains-card.tsx"),
    "utf-8"
  );

  it("the verify-failure banner renders ONLY verifyState.error (no challenge / token / record_value concatenation)", () => {
    // Find the verify error block.
    const errorBlockMatch = CARD_SRC.match(
      /verifyState\.phase\s*===\s*"error"[\s\S]*?\{verifyState\.error\}[\s\S]*?<\/div>/
    );
    expect(errorBlockMatch).not.toBeNull();
    const errorBlock = errorBlockMatch?.[0] ?? "";
    // The block must not read any other field from verifyState — a
    // regression that started rendering verifyState.challenge or
    // verifyState.record_value would surface here.
    expect(errorBlock).not.toMatch(/verifyState\.challenge/);
    expect(errorBlock).not.toMatch(/verifyState\.record_value/);
    expect(errorBlock).not.toMatch(/verifyState\.token/);
    expect(errorBlock).not.toMatch(/verifyState\.hash/);
    // And must not concatenate it with addState (which DOES carry the
    // challenge value on its success branch).
    expect(errorBlock).not.toMatch(/addState\./);
  });

  it("the Verify button is the ONLY verify affordance and is gated by !d.verified — pending rows stay clickable after failure", () => {
    // Already covered upstream as a generic source pin; restated here
    // as a slice-2 invariant. A verify failure does not mutate the row,
    // so the next render still sees `!d.verified` and re-renders the
    // Verify button. This makes "click Verify, see safe error, row
    // remains Pending and clickable" a structural property of the
    // component rather than an emergent one.
    const verifyButtonOccurrences = (CARD_SRC.match(/verifyButton/g) || []).length;
    expect(verifyButtonOccurrences).toBe(1);
  });

  it("does not use localStorage, sessionStorage, or console for any verify-related value", () => {
    // Re-pinned as a slice-2 invariant. The challenge value must not
    // hop into any browser storage primitive between renders.
    expect(CARD_SRC).not.toMatch(/localStorage/);
    expect(CARD_SRC).not.toMatch(/sessionStorage/);
    expect(CARD_SRC).not.toMatch(/console\.\w+/);
  });
});

// ── Remove-failure UX (slice 5) ────────────────────────────────────────────
//
// The remove server action maps the IDP's three documented outcomes
// (notFound / primary / other) onto three operator-safe copy strings
// on ORG_ADMIN_DOMAINS_CARD_COPY. The invariants pinned here:
//
//   1. The three new copy keys exist and read as actionable operator
//      guidance.
//   2. NONE of them name the DNS challenge record_value, the raw
//      token, a token hash, cookies, or any backend stack/error code.
//   3. The action source MUST reference each of the three copy keys
//      exactly once (so a regression that re-inlined a backend
//      message or dropped one branch would surface).
//   4. The action's error envelope on the remove path MUST NOT carry
//      the challenge, the record_value, the token, or any hash
//      through to the UI.
//   5. The DomainsCard renders removeState.error verbatim with no
//      concatenation with challenge / token / record_value substrings.
//   6. The Remove control is the ONLY remove affordance and remains
//      gated by !d.is_primary — pinned upstream as the slice-1
//      invariant, restated here as the slice-5 invariant.
//   7. deleteOrganizationDomainAction continues to derive org id
//      server-side and validate the domain_id at the action layer
//      (defense-in-depth before the IDP).

describe("ORG_ADMIN_DOMAINS_CARD_COPY — remove-failure copy bundle (slice 5)", () => {
  it("declares the three removeError* keys with non-empty operator copy", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorPrimaryConflict.length).toBeGreaterThan(0);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorNotFound.length).toBeGreaterThan(0);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorGeneric.length).toBeGreaterThan(0);
  });

  it("removeErrorPrimaryConflict points the operator at the set-primary workflow", () => {
    // Load-bearing actionable copy: the operator must understand the
    // next step (promote another verified domain to primary first).
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorPrimaryConflict).toMatch(/primary/i);
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorPrimaryConflict).toMatch(
      /set\s+(another\s+)?verified/i
    );
  });

  it("removeErrorNotFound is the safe missing-row string", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorNotFound).toMatch(/not\s+found/i);
  });

  it("removeErrorGeneric is a safe fallback that hides the backend message", () => {
    expect(ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorGeneric).toMatch(/try\s+again/i);
  });

  it("NONE of the removeError* strings name the challenge value, token, hash, or internal cookie/header", () => {
    // Mirrors the slice-2 verify-error negative invariant. A
    // regression that helpfully echoed "you tried to remove X with
    // challenge Y" into the remove-failure banner would leak the
    // challenge value into the rendered DOM and into any error
    // screenshot.
    const REMOVE_ERROR_STRINGS = [
      ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorPrimaryConflict,
      ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorNotFound,
      ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorGeneric,
    ];
    const BANNED: RegExp[] = [
      /record_value/i,
      /\btoken\b/i,
      /token_hash/i,
      /verification_token_hash/i,
      /hash\b/i,
      /Set-Cookie/i,
      /\bcookie\b/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /\bidentuum-challenge=/i,
      /_identuum-challenge\./i,
      /\bstack\b/i,
      /\bdebug\b/i,
    ];
    for (const s of REMOVE_ERROR_STRINGS) {
      for (const pat of BANNED) {
        expect(s, `remove-error copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

describe("deleteOrganizationDomainAction — safe remove path (slice 5)", () => {
  const ACTIONS_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "domains-actions.ts"),
    "utf-8"
  );
  // Isolate the delete action body so negative assertions stay
  // scoped to the right block.
  const deleteBody = (() => {
    const start = ACTIONS_SRC.indexOf("export async function deleteOrganizationDomainAction");
    expect(start).toBeGreaterThanOrEqual(0);
    const tail = ACTIONS_SRC.slice(start);
    const nextSep = tail.indexOf("// ── Set primary");
    return nextSep > 0 ? tail.slice(0, nextSep) : tail;
  })();

  it("derives org id server-side via getOwnOrganization and NEVER reads it from form data", () => {
    expect(deleteBody).toMatch(/getOwnOrganization\(\)/);
    expect(deleteBody).not.toMatch(/formData\.get\(\s*["']organization_id["']\s*\)/);
    expect(deleteBody).not.toMatch(/formData\.get\(\s*["']org_id["']\s*\)/);
  });

  it("re-validates the session AND the org_admin role (belt-and-suspenders beyond the layout guard)", () => {
    expect(deleteBody).toMatch(/getServerSession\(\)/);
    expect(deleteBody).toMatch(/role\s*!==\s*"org_admin"/);
  });

  it("validates the domain_id form field with a UUID regex before calling the client", () => {
    // The slice-1 action already enforces this — pinning so a
    // regression that started accepting arbitrary strings on the
    // remove path would surface.
    expect(deleteBody).toMatch(/formData\.get\(\s*["']domain_id["']\s*\)/);
    expect(deleteBody).toMatch(/\/\^\[0-9a-fA-F-\]\{32,36\}\$\/.*test\(domainID\)/);
  });

  it("references each of the three removeError* copy keys exactly once", () => {
    expect(
      (deleteBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.removeErrorPrimaryConflict/g) || []).length
    ).toBe(1);
    expect(
      (deleteBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.removeErrorNotFound/g) || []).length
    ).toBe(1);
    expect(
      (deleteBody.match(/ORG_ADMIN_DOMAINS_CARD_COPY\.removeErrorGeneric/g) || []).length
    ).toBe(1);
  });

  it("error envelope never carries challenge / record_value / token / hash through to the UI", () => {
    // The discriminated state shape on the action only declares
    // { phase: "error"; error: string }. Defense-in-depth: the body
    // must not read challenge/token/hash from the result either.
    expect(deleteBody).not.toMatch(/result\.\w*challenge\b/i);
    expect(deleteBody).not.toMatch(/result\.\w*token\b/i);
    expect(deleteBody).not.toMatch(/result\.\w*hash\b/i);
    expect(deleteBody).not.toMatch(/record_value/);
  });

  it("revalidates /org-admin/settings ONLY on the success branch", () => {
    // A regression that revalidated on the error branch would hide
    // a failure-rollback from the operator (the cached list would
    // be refetched and could mislead them). Pin the success-only
    // contract.
    const revalidate = deleteBody.match(/revalidatePath\(\s*["']\/org-admin\/settings["']\s*\)/g);
    expect(revalidate?.length ?? 0).toBe(1);
    // The revalidate call must appear inside the `result.ok` block.
    const okBlock = deleteBody.match(/if\s*\(result\.ok\)\s*\{[\s\S]*?\}/);
    expect(okBlock).not.toBeNull();
    expect(okBlock?.[0] ?? "").toMatch(/revalidatePath/);
  });
});

describe("DomainsCard — remove rendering (slice 5)", () => {
  const CARD_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "domains-card.tsx"),
    "utf-8"
  );

  it("the remove success banner reads ONLY removeState.domain (no challenge / token / record_value concatenation)", () => {
    // Find the remove success block.
    const successMatch = CARD_SRC.match(
      /removeState\.phase\s*===\s*"success"[\s\S]*?removeState\.domain[\s\S]*?<\/div>/
    );
    expect(successMatch).not.toBeNull();
    const block = successMatch?.[0] ?? "";
    expect(block).not.toMatch(/removeState\.challenge/);
    expect(block).not.toMatch(/removeState\.record_value/);
    expect(block).not.toMatch(/removeState\.token/);
    expect(block).not.toMatch(/removeState\.hash/);
    expect(block).not.toMatch(/addState\./);
  });

  it("the remove failure banner reads ONLY removeState.error", () => {
    const errorMatch = CARD_SRC.match(
      /removeState\.phase\s*===\s*"error"[\s\S]*?\{removeState\.error\}[\s\S]*?<\/div>/
    );
    expect(errorMatch).not.toBeNull();
    const block = errorMatch?.[0] ?? "";
    expect(block).not.toMatch(/removeState\.challenge/);
    expect(block).not.toMatch(/removeState\.record_value/);
    expect(block).not.toMatch(/removeState\.token/);
    expect(block).not.toMatch(/removeState\.hash/);
  });

  it("the Remove control is the ONLY remove affordance and is gated by !d.is_primary (re-pin)", () => {
    // Restating the slice-1 invariant as the slice-5 invariant.
    // A regression that added a second unconditional Remove form
    // would surface as occurrences > 1.
    const occurrences = (CARD_SRC.match(/removeButton/g) || []).length;
    expect(occurrences).toBe(1);
    expect(CARD_SRC).toMatch(/\{!d\.is_primary && \(\s*<form[\s\S]*?removeButton/);
  });
});

describe("/org-admin/settings page wiring — DomainsCard replaces placeholder", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "page.tsx"),
    "utf-8"
  );

  it("imports DomainsCard and listOrganizationDomains", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{\s*DomainsCard\s*\}\s*from\s+["']@\/components\/org-admin\/domains-card["']/
    );
    expect(PAGE_SRC).toMatch(/listOrganizationDomains/);
  });

  it("renders <DomainsCard domains=... loadError=... />", () => {
    expect(PAGE_SRC).toMatch(
      /<DomainsCard\s+domains=\{\s*domains\s*\}\s+loadError=\{\s*domainsLoadError\s*\}\s*\/>/
    );
  });

  it("derives orgID server-side via org?.id (NEVER from a URL param or form data)", () => {
    // Slice identuum-20260530-org-admin-settings-readonly-tabs
    // refactored the per-card await into a single Promise.all that
    // also fetches IdPs/Webhooks/Roles/Scope-Templates. The orgID
    // continues to be derived from the session-derived `org?.id` and
    // never from a URL param. Accept either the prior shape OR the
    // current `const orgID = org?.id ?? ""` + `listOrganizationDomains(orgID)` shape.
    const oldShape = /org\?\.id\s*\?\s*await\s+listOrganizationDomains/.test(PAGE_SRC);
    const newShape =
      /const\s+orgID\s*=\s*org\?\.id\s*\?\?\s*""/.test(PAGE_SRC) &&
      /listOrganizationDomains\(orgID\)/.test(PAGE_SRC);
    expect(oldShape || newShape).toBe(true);
    expect(PAGE_SRC).not.toMatch(/searchParams/);
  });
});
