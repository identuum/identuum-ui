/**
 * Tests for AuditIPAddressCell — the shared full-audit-table IP cell.
 *
 * Behaviour pinned here:
 *   - Real IP values (with or without /32 CIDR suffix) render verbatim.
 *   - Null / undefined / empty string render the operator-facing
 *     "Not captured" placeholder via the muted-italic span.
 *   - The exported copy constant carries the exact string "Not captured"
 *     so a regression that softened it (e.g. to "—" again, or to
 *     "Unknown") would surface.
 *
 * Source-text pins:
 *   - Both /org-admin/audit and /site-admin/audit render via
 *     <AuditIPAddressCell value={e.ip_address} /> and no longer
 *     inline the previous `?? <span className="text-stone-300">—</span>`
 *     placeholder.
 *   - The compact Recent activity card on /org-admin/users/[id]
 *     still does NOT render ip_address (the slice-9 invariant).
 *   - The helper module itself never reads / forwards raw audit
 *     metadata.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AUDIT_IP_NOT_CAPTURED_COPY,
  AuditIPAddressCell,
} from "../components/shared/audit-ip-address-cell";

// ── Copy constant ──────────────────────────────────────────────────────────

describe("AUDIT_IP_NOT_CAPTURED_COPY", () => {
  it("is the exact string 'Not captured'", () => {
    expect(AUDIT_IP_NOT_CAPTURED_COPY).toBe("Not captured");
  });

  it("is operator-clear (not a bare em dash or other ambiguous placeholder)", () => {
    // Sentry against a future regression that softened the copy
    // back to "—" / "Unknown" / "N/A" — each of those is vague
    // about whether the IP is intentionally hidden vs not recorded.
    expect(AUDIT_IP_NOT_CAPTURED_COPY).not.toBe("—");
    expect(AUDIT_IP_NOT_CAPTURED_COPY).not.toBe("-");
    expect(AUDIT_IP_NOT_CAPTURED_COPY).not.toMatch(/^Unknown$/i);
    expect(AUDIT_IP_NOT_CAPTURED_COPY).not.toMatch(/^N\/A$/i);
  });
});

// ── Behavioural rendering ──────────────────────────────────────────────────

describe("AuditIPAddressCell — render shape", () => {
  it("renders the IP verbatim when a non-empty value is supplied", () => {
    const el = AuditIPAddressCell({ value: "203.0.113.45" });
    expect(isValidElement(el)).toBe(true);
    // The non-empty branch returns a Fragment whose children is the
    // raw string (preserves the existing render shape). Walk the
    // children array.
    const children = (el as { props: { children?: unknown } }).props.children;
    expect(children).toBe("203.0.113.45");
  });

  it("preserves CIDR-style /32 values (the Postgres INET stringification)", () => {
    const el = AuditIPAddressCell({ value: "192.0.2.7/32" });
    const children = (el as { props: { children?: unknown } }).props.children;
    expect(children).toBe("192.0.2.7/32");
  });

  it("renders the 'Not captured' placeholder when value is null", () => {
    const el = AuditIPAddressCell({ value: null });
    expect(isValidElement(el)).toBe(true);
    // The fallback branch returns a <span> with the copy constant.
    const props = (el as { props: { children?: unknown; className?: string; title?: string } })
      .props;
    expect(props.children).toBe(AUDIT_IP_NOT_CAPTURED_COPY);
    // Muted-italic styling — not text-stone-300 (which would
    // visually be indistinguishable from the previous "—").
    expect(typeof props.className).toBe("string");
    expect(props.className).toContain("italic");
    expect(props.className).toContain("text-stone-400");
    // Belt-and-suspenders: tooltip explains the placeholder.
    expect(typeof props.title).toBe("string");
    expect(props.title?.toLowerCase()).toContain("no client ip");
  });

  it("renders the 'Not captured' placeholder when value is undefined", () => {
    const el = AuditIPAddressCell({ value: undefined });
    const children = (el as { props: { children?: unknown } }).props.children;
    expect(children).toBe(AUDIT_IP_NOT_CAPTURED_COPY);
  });

  it("renders the 'Not captured' placeholder when value is an empty string (defence in depth)", () => {
    // The IDP-side prepareEvent coerces empty IP → nil → JSON null,
    // but the UI helper also defends against an empty-string slipping
    // through any future regression.
    const el = AuditIPAddressCell({ value: "" });
    const children = (el as { props: { children?: unknown } }).props.children;
    expect(children).toBe(AUDIT_IP_NOT_CAPTURED_COPY);
  });
});

// ── Audit page source contract ──────────────────────────────────────────────

describe("/org-admin/audit + /site-admin/audit — IP cell wiring", () => {
  const ORG_ADMIN_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "audit", "page.tsx"),
    "utf-8"
  );
  const SITE_ADMIN_SRC = readFileSync(
    resolve(__dirname, "..", "app", "site-admin", "audit", "page.tsx"),
    "utf-8"
  );

  it("org-admin audit page imports AuditIPAddressCell", () => {
    expect(ORG_ADMIN_SRC).toMatch(
      /import\s*\{\s*AuditIPAddressCell\s*\}\s*from\s+["']@\/components\/shared\/audit-ip-address-cell["']/
    );
  });

  it("site-admin audit page imports AuditIPAddressCell", () => {
    expect(SITE_ADMIN_SRC).toMatch(
      /import\s*\{\s*AuditIPAddressCell\s*\}\s*from\s+["']@\/components\/shared\/audit-ip-address-cell["']/
    );
  });

  it("org-admin audit page renders <AuditIPAddressCell value={e.ip_address} />", () => {
    expect(ORG_ADMIN_SRC).toMatch(/<AuditIPAddressCell\s+value=\{\s*e\.ip_address\s*\}\s*\/>/);
  });

  it("site-admin audit page renders <AuditIPAddressCell value={e.ip_address} />", () => {
    expect(SITE_ADMIN_SRC).toMatch(/<AuditIPAddressCell\s+value=\{\s*e\.ip_address\s*\}\s*\/>/);
  });

  it("the previous '?? <span className=text-stone-300>—</span>' inline placeholder is GONE on both pages", () => {
    // The exact previous render. A regression that revived it would
    // re-introduce the vague "—" copy.
    const banned = /e\.ip_address\s*\?\?\s*<span\s+className="text-stone-300">—<\/span>/;
    expect(ORG_ADMIN_SRC).not.toMatch(banned);
    expect(SITE_ADMIN_SRC).not.toMatch(banned);
  });

  it("neither audit page renders raw audit metadata in the IP column", () => {
    // The helper renders only the value string OR the
    // copy constant. The audit pages must not have started
    // rendering raw metadata fields adjacent to the IP cell — a
    // regression that pulled e.metadata into the IP cell would
    // surface here.
    const ipCellBlock = (src: string): string => {
      const idx = src.indexOf("<AuditIPAddressCell");
      expect(idx).toBeGreaterThanOrEqual(0);
      // Capture ~250 chars around the cell for the negative scan.
      return src.slice(Math.max(0, idx - 50), Math.min(src.length, idx + 250));
    };
    for (const src of [ORG_ADMIN_SRC, SITE_ADMIN_SRC]) {
      const block = ipCellBlock(src);
      expect(block).not.toMatch(/e\.metadata/);
      expect(block).not.toMatch(/JSON\.stringify\(/);
    }
  });
});

// ── Recent activity card invariant — no IP regression ──────────────────────

describe("/org-admin/users/[id] Recent activity card — still no ip_address", () => {
  // This is a re-pin of the slice-9 invariant. Adding a shared
  // AuditIPAddressCell to the audit table MUST NOT tempt a future
  // maintainer to also use it in the compact Recent activity rows.
  const USER_DETAIL_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "users", "[id]", "page.tsx"),
    "utf-8"
  );

  it("does NOT import AuditIPAddressCell", () => {
    expect(USER_DETAIL_SRC).not.toMatch(/AuditIPAddressCell/);
  });

  it("does NOT reference ip_address in any code path", () => {
    expect(USER_DETAIL_SRC).not.toMatch(/ip_address/);
  });
});

// ── Helper module purity ───────────────────────────────────────────────────

describe("audit-ip-address-cell.tsx — module purity", () => {
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "components", "shared", "audit-ip-address-cell.tsx"),
    "utf-8"
  );

  it("has no I/O, no logging, no DOM-mutating side effects", () => {
    expect(HELPER_SRC).not.toMatch(/from\s+["']next\/headers["']/);
    expect(HELPER_SRC).not.toMatch(/from\s+["']server-only["']/);
    expect(HELPER_SRC).not.toMatch(/\bfetch\(/);
    expect(HELPER_SRC).not.toMatch(/\bconsole\./);
    expect(HELPER_SRC).not.toMatch(/from\s+["']node:/);
  });

  it("does not reference raw audit metadata or sensitive fields", () => {
    // Strip comments first so the JSDoc doc-block that legitimately
    // names the forbidden fields (as a documented exclusion list)
    // does not trip the assertions. Real code that READS one of
    // those fields would survive the strip.
    const noComments = HELPER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const BANNED: RegExp[] = [
      /metadata/i,
      /user_agent/i,
      /session_token/i,
      /refresh_token/i,
      /\bpassword\b/i,
      /\btotp\b/i,
      /\bsecret\b/i,
      /clientDataJSON/i,
      /authenticatorData/i,
      /attestationObject/i,
      /Set-Cookie/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /otpauth:\/\//i,
    ];
    for (const pat of BANNED) {
      expect(noComments).not.toMatch(pat);
    }
  });
});
