/**
 * audit-details-source-invariants.test.ts — THE-AUDIT-SURFACE / AUDIT-DETAILS-1
 *
 * The audit-event list mapper must project the MEASURED wire contract
 * (auditEventView in identuum-idp-oss internal/handlers/audit_events.go) and
 * nothing else, and the site-admin audit page must make those measured fields
 * visible per-event without leaving the page.
 *
 * Measured 2026-08-20 via `gograph fields auditEventView` (identuum-idp-oss):
 * the wire emits exactly these 18 keys — id, created_at, event_type, outcome,
 * actor_id, actor_type, actor_email, actor_role, actor_organization_id,
 * subject_id, subject_type, subject_email, ip_address, user_agent, request_id,
 * correlation_id, priority, metadata. There is NO `summary` key — the UI had
 * invented one that was always null. This pin holds two teeth:
 *
 *   (WIRE-READ) listAuditEvents reads only contract keys — no invented
 *   `summary`, no fabricated field — and projects the details-bearing keys
 *   (outcome / actor_id / actor_organization_id / user_agent / request_id /
 *   correlation_id / metadata) so the page has something to show.
 *
 *   (RENDER) the site-admin audit page's per-event AuditEventDetails surfaces
 *   those measured fields (read-only, expandable) — metadata via
 *   JSON.stringify, the scalar fields by their contract names.
 *
 * Source-invariant style (no React render, no network) — matches
 * phantom-no-admin-mapping.test.ts / edition-surface-source-invariants.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

// The measured auditEventView wire contract (gograph fields auditEventView).
const WIRE_KEYS = [
  "id",
  "created_at",
  "event_type",
  "outcome",
  "actor_id",
  "actor_type",
  "actor_email",
  "actor_role",
  "actor_organization_id",
  "subject_id",
  "subject_type",
  "subject_email",
  "ip_address",
  "user_agent",
  "request_id",
  "correlation_id",
  "priority",
  "metadata",
];

// The details-bearing keys the mapper MUST carry through so the page can show
// them — the point of the row (an OSS event's details become visible).
const DETAIL_KEYS = [
  "outcome",
  "actor_id",
  "actor_organization_id",
  "user_agent",
  "request_id",
  "correlation_id",
  "metadata",
];

function mapperSpan(source: string, fnName: string): string {
  const start = source.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName} not found in idp-admin-client.ts`).toBeGreaterThan(-1);
  const next = source.slice(start + 1).search(/\nexport /);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("AUDIT-DETAILS-1 — audit-event details are the measured contract, projected and shown", () => {
  it("listAuditEvents reads only contract keys (no invented summary) and the audit page renders per-event details [AUDIT-DETAILS-1]", () => {
    const client = src("lib/idp-admin-client.ts");
    const span = mapperSpan(client, "listAuditEvents");
    const allowed = new Set(WIRE_KEYS);

    // (WIRE-READ) Every `e.<key>` the mapper reads is a real contract key —
    // catches a reintroduced `e.summary` or any fabricated field.
    const reads = new Set([...span.matchAll(/\be\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));
    expect(reads.size, "no e.<key> reads found — span extraction broke, fix the pin").toBeGreaterThan(
      8
    );
    for (const k of reads) {
      expect(allowed.has(k), `listAuditEvents reads non-contract wire key e.${k}`).toBe(true);
    }
    // The invented `summary` must be gone from the reader entirely.
    expect(reads.has("summary"), "the invented `summary` key must not be read").toBe(false);

    // (WIRE-READ) The details-bearing keys are actually projected — so the
    // details view has data to surface, not just an empty contract.
    for (const k of DETAIL_KEYS) {
      expect(span, `listAuditEvents must project the contract key \`${k}\``).toMatch(
        new RegExp(`\\b${k}:`)
      );
    }

    // (RENDER) The site-admin audit page surfaces those fields per-event in an
    // expandable, read-only details view.
    const page = src("app/site-admin/audit/page.tsx");
    expect(page).toContain("function AuditEventDetails");
    expect(page).toMatch(/<AuditEventDetails event=\{e\}/);
    // The scalar detail fields are read off the event by their contract names.
    for (const k of ["outcome", "actor_id", "actor_organization_id", "user_agent", "request_id", "correlation_id"]) {
      expect(page, `AuditEventDetails must surface event.${k}`).toMatch(
        new RegExp(`event\\.${k}\\b`)
      );
    }
    // Metadata is rendered (read-only) via JSON.stringify — no invented shape.
    expect(page).toMatch(/JSON\.stringify\(event\.metadata\)/);
    // The invented `summary` render is gone from the audit surface.
    expect(page).not.toMatch(/\.summary\b/);
  });
});
