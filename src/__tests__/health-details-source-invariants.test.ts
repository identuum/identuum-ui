/**
 * health-details-source-invariants.test.ts — THE-HEALTH-DETAILS / HEALTH-DETAILS-UI-1
 *
 * Runtime info IS an OSS feature (owner ruling 2026-08-19). The UI must:
 *   - map a non-ok /api/v1/health/details response through the shared
 *     classifyAdminReadFailure (so a 404 from a stale/non-IDP backend becomes
 *     featureUnavailable, not a fake outage);
 *   - keep SystemInfo tri-state — an ABSENT field stays `undefined` and is
 *     rendered "unknown", never zero-faked to "" / 0 / null (the backend twin,
 *     WIRE-CONTRACT-HEALTH-1, omits redis + audit queue_depth);
 *   - render featureUnavailable as an honest boundary, and only the
 *     non-featureUnavailable failure as the outage ErrorPanel.
 *
 * Source-invariant style (no React render, no network).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const adminClient = src("lib/idp-admin-client.ts");
const infoPage = src("app/site-admin/system/info/page.tsx");

describe("HEALTH-DETAILS-UI-1 — runtime info: classified failures, tri-state absence, honest copy", () => {
  it("getSystemInfo classifies failures + tri-states absent fields, and the page renders absence as unknown [HEALTH-DETAILS-UI-1]", () => {
    // (1) GetSystemInfoResult failure variant carries featureUnavailable.
    const resultType = adminClient.match(/export type GetSystemInfoResult =[\s\S]*?;\n/);
    expect(resultType, "GetSystemInfoResult must be declared").not.toBeNull();
    expect(resultType?.[0]).toContain("featureUnavailable");

    // (2) getSystemInfo routes its non-ok branch through the shared classifier
    // (404 → featureUnavailable), NOT the old forbidden:false swallow.
    const fn = adminClient.match(/export async function getSystemInfo\(\)[\s\S]*?\n}\n/);
    expect(fn, "getSystemInfo must be declared").not.toBeNull();
    expect(fn?.[0]).toContain("classifyAdminReadFailure(res)");

    // (3) SystemInfo is tri-state: the absent-capable fields are optional, and
    // the projection uses `undefined` for absence (never "" / 0 / null).
    const iface = adminClient.match(/export interface SystemInfo \{[\s\S]*?\n\}/);
    expect(iface, "SystemInfo must be declared").not.toBeNull();
    expect(iface?.[0]).toMatch(/database_status\?:/);
    expect(iface?.[0]).toMatch(/audit_queue_depth\?:/);
    expect(iface?.[0]).toMatch(/redis_status\?:/);
    expect(fn?.[0]).toMatch(/database_status:[^\n]*undefined/);
    expect(fn?.[0]).toMatch(/audit_queue_depth:[\s\S]*?undefined/);

    // (4) The page renders absent fields as "unknown", and maps
    // featureUnavailable to the shared boundary panel — the outage ErrorPanel
    // is reserved for the non-featureUnavailable failure only.
    expect(infoPage).toContain("FeatureBoundaryPanel");
    expect(infoPage).toMatch(/result\.featureUnavailable/);
    expect(infoPage).toMatch(/!result\.featureUnavailable[\s\S]*?ErrorPanel/);
    expect(infoPage).toMatch(/database_status \?\? "unknown"/);
    expect(infoPage).toMatch(/audit_system_status \?\? "unknown"/);
  });
});
