/**
 * edition-surface-source-invariants.test.ts — EDITION-SURFACE-1 / EDITION-GATE-1
 *
 * A commercial-only surface that an OSS backend does not serve (404) must be
 * mapped to an edition boundary, not a fake outage. Measured 2026-08-19:
 * /api/v1/system/sessions answers 404 on identuum-idp-oss (the OSS handler
 * comments name it "the commercial /api/v1/system/sessions route"), and the
 * Admin-sessions page mapped every non-403 failure to a generic outage panel.
 *
 * These pins hold three things so the regression cannot silently return:
 *   1. listAdminSessions classifies its failures through the shared
 *      classifyAdminReadFailure — the SAME mechanism verifyAuditChain /
 *      getAnomalyStats use — so a 404 (feature_absent) yields
 *      featureUnavailable, and the result type carries that flag.
 *   2. The Admin-sessions page renders the shared FeatureBoundaryPanel on
 *      featureUnavailable and reserves the outage ErrorPanel for the
 *      NON-featureUnavailable case only.
 *   3. The System index CONSULTS the capability source (getServerRuntimeState
 *      → components.idp.capabilities) and labels commercial-only cards.
 *
 * Source-invariant style (no React render, no network) — matches
 * absent-backend-not-failure.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const adminClient = src("lib/idp-admin-client.ts");
const sessionsPage = src("app/site-admin/system/sessions/page.tsx");
const systemIndex = src("app/site-admin/system/page.tsx");

describe("EDITION-GATE-1 — commercial-only surfaces are an edition boundary, never an outage", () => {
  it("admin-session absence maps to featureUnavailable and the System index consults the capability source [EDITION-GATE-1]", () => {
    // (1) The ListAdminSessionsResult failure variant carries featureUnavailable.
    const resultType = adminClient.match(/export type ListAdminSessionsResult =[\s\S]*?;\n/);
    expect(resultType, "ListAdminSessionsResult must be declared").not.toBeNull();
    expect(resultType?.[0]).toContain("featureUnavailable");

    // (2) listAdminSessions routes its non-ok branch through the shared
    // classifyAdminReadFailure (which sets featureUnavailable on a 404
    // feature_absent), NOT the old `forbidden: false` shortcut that swallowed a
    // 404 into a generic error.
    const fn = adminClient.match(/export async function listAdminSessions\(\)[\s\S]*?\n}\n/);
    expect(fn, "listAdminSessions must be declared").not.toBeNull();
    expect(fn?.[0]).toContain("classifyAdminReadFailure(res)");

    // (3) The Admin-sessions page renders the shared boundary panel on
    // featureUnavailable, and the outage ErrorPanel only when NOT
    // featureUnavailable — the whole point of the distinction.
    expect(sessionsPage).toContain("FeatureBoundaryPanel");
    expect(sessionsPage).toMatch(/result\.featureUnavailable/);
    expect(sessionsPage).toMatch(/!result\.featureUnavailable[\s\S]*?ErrorPanel/);

    // (4) The System index consults the discovered capabilities (the same
    // source the nav gates on) and labels commercial-only cards — audit-chain
    // by its capability key, admin-sessions as commercial-without-capability
    // (the OSS payload carries no admin_sessions flag).
    expect(systemIndex).toContain("getServerRuntimeState");
    expect(systemIndex).toMatch(/components\.idp\.capabilities/);
    expect(systemIndex).toMatch(/capability:\s*"audit_chain"/);
    expect(systemIndex).toContain("commercialWithoutCapability");
    expect(systemIndex).toContain("Enterprise/CE");
  });
});
