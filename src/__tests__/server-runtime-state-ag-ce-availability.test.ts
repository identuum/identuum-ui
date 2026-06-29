/**
 * server-runtime-state-ag-ce-availability.test.ts
 *
 * 2026-07-08 source-invariant pins for the runtime-composition slice
 * that moved the AG CE org-link availability fetch + derive into
 * `getServerRuntimeState`. Two pages (/site-admin/org-link/readiness
 * + /platform-status) used to fetch and derive directly; that
 * duplication was the explicit target of this slice.
 *
 * Acceptance criteria covered:
 *   - `lib/server-runtime-state.ts` imports the readiness client +
 *     availability helper and composes the verdict alongside the
 *     existing `discoverRuntime` call.
 *   - The composition runs both probes in parallel via Promise.all
 *     (single round-trip; no new serial latency added when AG is
 *     configured).
 *   - The readiness probe is SKIPPED when AG is not enabled
 *     (avoids an unnecessary fetch + lets the resulting state
 *     carry `agCEOrgLinkAvailability: null` for unconfigured-AG
 *     deployments).
 *   - The RuntimeState type carries the new optional verdict field.
 *   - server-runtime-state.ts is still `import "server-only"` and
 *     does not introduce browser-visible credential storage.
 *   - The readiness client is consumed only here — neither page
 *     re-imports `fetchAGOrgLinkReadiness` nor
 *     `deriveAGCEOrgLinkAvailability` (the consolidation invariant).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const SERVER_STATE_PATH = resolve(SRC_ROOT, "lib/server-runtime-state.ts");
const TYPES_PATH = resolve(SRC_ROOT, "lib/types.ts");
const READINESS_PAGE_PATH = resolve(SRC_ROOT, "app/site-admin/org-link/readiness/page.tsx");
const PLATFORM_STATUS_PATH = resolve(SRC_ROOT, "app/platform-status/page.tsx");

const SERVER_STATE_SOURCE = readFileSync(SERVER_STATE_PATH, "utf-8");
const TYPES_SOURCE = readFileSync(TYPES_PATH, "utf-8");
const READINESS_PAGE_SOURCE = readFileSync(READINESS_PAGE_PATH, "utf-8");
const PLATFORM_STATUS_SOURCE = readFileSync(PLATFORM_STATUS_PATH, "utf-8");

describe("RuntimeState type carries agCEOrgLinkAvailability", () => {
  it("imports the AGCEOrgLinkAvailability type", () => {
    expect(TYPES_SOURCE).toContain(
      'import type { AGCEOrgLinkAvailability } from "./ag-ce-org-linking-availability"'
    );
  });

  it("declares an optional agCEOrgLinkAvailability field on RuntimeState", () => {
    expect(TYPES_SOURCE).toContain("agCEOrgLinkAvailability?: AGCEOrgLinkAvailability | null;");
  });
});

describe("getServerRuntimeState composes the AG CE org-link availability verdict", () => {
  it("imports the readiness client + availability helper", () => {
    expect(SERVER_STATE_SOURCE).toContain(
      'import { deriveAGCEOrgLinkAvailability } from "./ag-ce-org-linking-availability"'
    );
    expect(SERVER_STATE_SOURCE).toContain(
      'import { fetchAGOrgLinkReadiness } from "./ag-org-link-readiness-client"'
    );
  });

  it("runs discoverRuntime + the readiness probe in parallel via Promise.all", () => {
    expect(SERVER_STATE_SOURCE).toMatch(
      /await Promise\.all\(\[\s*discoverRuntime\(idpUrl, agUrl\),\s*agUrl \? fetchAGOrgLinkReadiness\(\) : Promise\.resolve\(null\),\s*\]\)/
    );
  });

  it("skips the readiness fetch when AG is not enabled (Promise.resolve(null) short-circuit)", () => {
    // The cleanup keeps the readiness client out of the runtime
    // round-trip when AG is unconfigured — the page then renders
    // with `state.agCEOrgLinkAvailability === null`.
    expect(SERVER_STATE_SOURCE).toContain(
      "agUrl ? fetchAGOrgLinkReadiness() : Promise.resolve(null)"
    );
  });

  it("derives the verdict only when a readiness result exists; sets null otherwise", () => {
    expect(SERVER_STATE_SOURCE).toContain("state.agCEOrgLinkAvailability = agCEReadinessResult");
    expect(SERVER_STATE_SOURCE).toContain(
      "deriveAGCEOrgLinkAvailability(state.components.ag.capabilities, agCEReadinessResult)"
    );
    expect(SERVER_STATE_SOURCE).toContain(": null");
  });

  it("remains import 'server-only' (no browser-visible credential storage introduced)", () => {
    expect(SERVER_STATE_SOURCE).toContain('import "server-only"');
    expect(SERVER_STATE_SOURCE).not.toContain("localStorage");
    expect(SERVER_STATE_SOURCE).not.toContain("sessionStorage");
    expect(SERVER_STATE_SOURCE).not.toContain("document.cookie");
    expect(SERVER_STATE_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
  });

  it("uses the existing React cache() per-request memoization (no regression)", () => {
    expect(SERVER_STATE_SOURCE).toContain('import { cache } from "react"');
    expect(SERVER_STATE_SOURCE).toContain("cache(async ()");
  });
});

describe("page-side consolidation — no direct readiness fetch in consumer pages", () => {
  it("/site-admin/org-link/readiness does NOT import fetchAGOrgLinkReadiness directly", () => {
    expect(READINESS_PAGE_SOURCE).not.toContain(
      'import { fetchAGOrgLinkReadiness } from "@/lib/ag-org-link-readiness-client"'
    );
  });

  it("/site-admin/org-link/readiness does NOT import deriveAGCEOrgLinkAvailability directly", () => {
    expect(READINESS_PAGE_SOURCE).not.toContain(
      'import { deriveAGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability"'
    );
  });

  it("/site-admin/org-link/readiness reads the verdict from runtime state", () => {
    expect(READINESS_PAGE_SOURCE).toContain("state.agCEOrgLinkAvailability");
  });

  it("/platform-status does NOT import fetchAGOrgLinkReadiness directly", () => {
    expect(PLATFORM_STATUS_SOURCE).not.toContain(
      'import { fetchAGOrgLinkReadiness } from "@/lib/ag-org-link-readiness-client"'
    );
  });

  it("/platform-status does NOT import deriveAGCEOrgLinkAvailability directly", () => {
    expect(PLATFORM_STATUS_SOURCE).not.toContain(
      'import { deriveAGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability"'
    );
  });

  it("/platform-status reads the verdict from runtime state", () => {
    expect(PLATFORM_STATUS_SOURCE).toContain("state.agCEOrgLinkAvailability");
  });

  it("both pages handle the null case (skipping the card when AG is not enabled)", () => {
    // Each page assigns the verdict from state with a `?? null`
    // fallback (covers the optional-undefined case) AND guards the
    // JSX render with `{agCEAvailability && (...)}` so the card is
    // not rendered when the verdict is null.
    expect(READINESS_PAGE_SOURCE).toContain("state.agCEOrgLinkAvailability ?? null");
    expect(PLATFORM_STATUS_SOURCE).toContain("state.agCEOrgLinkAvailability ?? null");
    expect(READINESS_PAGE_SOURCE).toContain("{agCEAvailability && (");
    expect(PLATFORM_STATUS_SOURCE).toContain("{agCEAvailability && (");
  });

  it("neither page references the AG CE availability lib helpers as named symbols", () => {
    // Defense-in-depth: even within string literals / comments, the
    // helper name must not appear in the consumer page sources (it
    // belongs to runtime-state composition only).
    expect(READINESS_PAGE_SOURCE).not.toContain("deriveAGCEOrgLinkAvailability");
    expect(READINESS_PAGE_SOURCE).not.toContain("fetchAGOrgLinkReadiness");
    expect(PLATFORM_STATUS_SOURCE).not.toContain("deriveAGCEOrgLinkAvailability");
    expect(PLATFORM_STATUS_SOURCE).not.toContain("fetchAGOrgLinkReadiness");
  });
});
