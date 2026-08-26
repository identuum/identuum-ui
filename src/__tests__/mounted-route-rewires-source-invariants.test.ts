/**
 * mounted-route-rewires-source-invariants.test.ts — MOUNTED-ROUTE-1
 *
 * THE-TWELVE (2026-08-26): two clicked admin surfaces called routes that
 * identuum-idp-oss never mounted, and every click 404'd:
 *
 *   assignOrgAdmin  POSTed /api/v1/organizations/:id/invitations —
 *                   pre-split ancestry; OSS's mounted equivalent is
 *                   POST /organizations/:id/resend-activation, which
 *                   takes NO body (the recipient is the org's existing
 *                   pending admin, resolved server-side).
 *   resetUserMFA    POSTed /api/v1/users/:id/mfa/reset — the mounted
 *                   OSS route is /users/:id/recovery/reset-mfa.
 *
 * These pins hold both functions on their MOUNTED routes and keep the
 * dead paths from quietly returning. The wiki's route-parity gate walks
 * the whole surface; this rule is the red-proved anchor for the two
 * paths a human actually clicked into a 404.
 *
 * Source-invariant style (no React render, no network).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const client = (): string => readFileSync(resolve(ROOT, "lib/idp-admin-client.ts"), "utf8");

const fnChunk = (src: string, name: string): string => {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const next = src.indexOf("export async function", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
};

describe("clicked admin surfaces call only mounted OSS routes", () => {
  it("assignOrgAdmin re-issues activation via the mounted route, bodiless [MOUNTED-ROUTE-1]", () => {
    const fn = fnChunk(client(), "assignOrgAdmin");
    expect(fn, "the mounted OSS route").toMatch(
      /\/api\/v1\/organizations\/\$\{encodeURIComponent\(opts\.orgId\)\}\/resend-activation/
    );
    expect(fn, "the unmounted pre-split route must not return").not.toMatch(/\/invitations/);
    expect(
      fn,
      "the OSS endpoint takes NO body — recipient_email was silently unacceptable"
    ).not.toMatch(/body:/);
    expect(fn, "the response's admin email is surfaced, not requested").toMatch(
      /adminEmail:\s*String\(data\.admin_email/
    );
  });

  it("resetUserMFA calls the mounted recovery route", () => {
    const fn = fnChunk(client(), "resetUserMFA");
    expect(fn, "the mounted OSS route").toMatch(
      /\/api\/v1\/users\/\$\{encodeURIComponent\(userId\)\}\/recovery\/reset-mfa/
    );
    expect(fn, "the unmounted path must not return").not.toMatch(/\/mfa\/reset`/);
  });
});
