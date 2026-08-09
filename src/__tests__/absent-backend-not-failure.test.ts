/**
 * absent-backend-not-failure.test.ts — THE-ABSENT-BACKEND
 *
 * ABSENCE IS NOT FAILURE. A backend that is not enabled in the runtime
 * config must not be MENTIONED by general surfaces — no card, no error, no
 * callout, no "Disabled" badge. A backend that IS enabled but unreachable
 * must still report Unavailable; that distinction is the whole point.
 *
 * The defect this pins against (found by hand-testing v0.3.3): the
 * /platform-status page rendered the AG BackendCard UNCONDITIONALLY while
 * the AgAuthProviderCard directly below it was guarded — an IdP-only
 * install saw "Agent Governance (AG)" reported as a state instead of not
 * being mentioned at all.
 *
 * Style: source-invariant pins + composition unit tests, no React render —
 * matches platform-status-ag-capability-display.test.ts. Red-proved by
 * running this file against the pre-fix tree (git stash): every source pin
 * in describe("guards") fails there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computePlatformMode, discoverRuntime } from "../lib/runtime-composition";

const ROOT = resolve(__dirname, "..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const PLATFORM_STATUS = src("app/platform-status/page.tsx");
const SETTINGS = src("app/site-admin/settings/page.tsx");
const SITE_ADMIN_CLIENT = src("app/site-admin/client.tsx");
const ORG_LINK = src("app/site-admin/org-link/page.tsx");
const ORG_LINK_READINESS = src("app/site-admin/org-link/readiness/page.tsx");
const NOTICE = src("components/shared/backend-not-configured-notice.tsx");

describe("THE-ABSENT-BACKEND — guards (source pins)", () => {
  it("platform-status renders the AG BackendCard only when cfg?.ag.enabled", () => {
    // The exact defect: an unconditional `<BackendCard label="Agent
    // Governance (AG)"` render. The guarded form reads
    // `{cfg?.ag.enabled && (\n <BackendCard\n label="Agent Governance (AG)"`.
    const agCard = PLATFORM_STATUS.indexOf('label="Agent Governance (AG)"');
    expect(agCard).toBeGreaterThan(-1);
    const before = PLATFORM_STATUS.slice(Math.max(0, agCard - 200), agCard);
    expect(before).toContain("cfg?.ag.enabled && (");
  });

  it("platform-status renders the IDP BackendCard only when cfg?.idp.enabled (symmetric rule)", () => {
    const idpCard = PLATFORM_STATUS.indexOf('label="Identity (IDP)"');
    expect(idpCard).toBeGreaterThan(-1);
    const before = PLATFORM_STATUS.slice(Math.max(0, idpCard - 400), idpCard);
    expect(before).toContain("cfg?.idp.enabled && (");
  });

  it("platform-status offers the org-link readiness drill-in only when AG is enabled", () => {
    const link = PLATFORM_STATUS.indexOf('href="/site-admin/org-link/readiness"');
    expect(link).toBeGreaterThan(-1);
    const before = PLATFORM_STATUS.slice(Math.max(0, link - 400), link);
    expect(before).toContain("cfg?.ag.enabled && (");
  });

  it("site-admin settings filters disabled backends out of System status", () => {
    // The rows render from `services.filter((svc) => svc.enabled)` — a
    // disabled backend gets no row and no "Disabled" badge.
    expect(SETTINGS).toContain("services.filter((svc) => svc.enabled)");
    // The Disabled badge branch survives only for the impossible-input
    // safety net; the render path never feeds it a disabled service.
  });

  it("site-admin overview renders CapabilityRows only for enabled backends", () => {
    expect(SITE_ADMIN_CLIENT).toContain("config.idp.enabled && (");
    expect(SITE_ADMIN_CLIENT).toContain("config.ag.enabled && (");
    // No `enabled={config.ag.enabled}` pass-through remains — a disabled
    // backend is not mentioned, not shown as a "disabled" chip.
    expect(SITE_ADMIN_CLIENT).not.toContain("enabled={config.ag.enabled}");
    expect(SITE_ADMIN_CLIENT).not.toContain("enabled={config.idp.enabled}");
  });

  it("org-link console short-circuits when EITHER backend is disabled (symmetric)", () => {
    expect(ORG_LINK).toContain("if (!agEnabled || !idpEnabled) {");
    expect(ORG_LINK).toContain("<BackendNotConfiguredNotice");
  });

  it("org-link readiness short-circuits when EITHER backend is disabled (symmetric)", () => {
    expect(ORG_LINK_READINESS).toContain("if (cfg && (!cfg.ag.enabled || !cfg.idp.enabled)) {");
    expect(ORG_LINK_READINESS).toContain("<BackendNotConfiguredNotice");
  });

  it("the shared notice covers ag, idp, and both — AG copy matches the /ag-admin route guard verbatim", () => {
    expect(NOTICE).toContain("Agent Governance not configured");
    expect(NOTICE).toContain("identuum-ag is not enabled in the current runtime configuration.");
    expect(NOTICE).toContain("Identity Provider not configured");
    expect(NOTICE).toContain("identuum-idp is not enabled in the current runtime configuration.");
    // The same wording the /ag-admin layout uses — one voice platform-wide.
    const AG_ADMIN_LAYOUT = src("app/ag-admin/layout.tsx");
    expect(AG_ADMIN_LAYOUT).toContain("Agent Governance not configured");
  });
});

describe("THE-ABSENT-BACKEND addendum — BOTH absent is an ERROR", () => {
  it("the shared notice's both-variant presents in the error style", () => {
    expect(NOTICE).toContain("No backends are enabled");
    expect(NOTICE).toContain('missing === "both"');
    // Error styling is keyed off the both-variant, red family.
    expect(NOTICE).toContain("border-red-200 bg-red-50");
  });

  it("platform-status's unconfigured mode badge is error-styled, not neutral", () => {
    const unconfigured = PLATFORM_STATUS.indexOf("unconfigured: {");
    expect(unconfigured).toBeGreaterThan(-1);
    const block = PLATFORM_STATUS.slice(unconfigured, unconfigured + 400);
    expect(block).toContain("bg-red-100 text-red-800 border-red-200");
    expect(block).toContain("invalid configuration");
    expect(block).not.toContain("bg-stone-100");
  });

  it("settings' both-absent empty state is error-styled and names the invalid config", () => {
    expect(SETTINGS).toContain("text-red-600");
    expect(SETTINGS).toContain("No backends are enabled — invalid runtime configuration.");
  });

  it("site-admin overview's both-absent rows use the error tone", () => {
    expect(SITE_ADMIN_CLIENT).toContain('tone="error"');
    expect(SITE_ADMIN_CLIENT).toContain("No backends are enabled — invalid runtime configuration.");
  });

  it("computePlatformMode: both-absent lands on the (now error-presented) unconfigured mode", () => {
    const absent = { configured: false, usable: false } as Parameters<
      typeof computePlatformMode
    >[0];
    expect(computePlatformMode(absent, absent)).toBe("unconfigured");
  });
});

describe("THE-ABSENT-BACKEND — absence vs failure stay distinct (composition)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a NOT-ENABLED AG (null base URL) yields configured=false and identity-only mode", async () => {
    // IdP answers; AG is passed as null (ag.enabled=false → no URL).
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/component")) {
        return Promise.resolve(
          new Response(JSON.stringify({ component: "identuum-idp", version: "x", status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      // setup/upgrade probes — irrelevant here
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const state = await discoverRuntime("http://idp.internal:7113", null);
    expect(state.components.ag.configured).toBe(false);
    expect(state.components.ag.usable).toBe(false);
    expect(state.components.ag.error).toBeNull();
    expect(state.mode).toBe("identity-only");
  });

  it("an ENABLED but unreachable AG yields configured=true — the Unavailable state, not absence", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes("idp.internal")) {
        return Promise.resolve(
          new Response(JSON.stringify({ component: "identuum-idp", version: "x", status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    const state = await discoverRuntime("http://idp.internal:7113", "http://ag.internal:7215");
    expect(state.components.ag.configured).toBe(true);
    expect(state.components.ag.usable).toBe(false);
    expect(state.mode).toBe("degraded-ag-unavailable");
  });

  it("computePlatformMode: identity-only requires AG NOT CONFIGURED; degraded requires AG configured", () => {
    const usable = { configured: true, usable: true } as Parameters<typeof computePlatformMode>[0];
    const absent = { configured: false, usable: false } as Parameters<
      typeof computePlatformMode
    >[1];
    const down = { configured: true, usable: false } as Parameters<typeof computePlatformMode>[1];
    expect(computePlatformMode(usable, absent)).toBe("identity-only");
    expect(computePlatformMode(usable, down)).toBe("degraded-ag-unavailable");
  });

  it("the BackendCard label vocabulary keeps Not configured ≠ Unavailable", () => {
    // Source pin on the card's status ternary: usable → Operational,
    // configured → Unavailable, else → Not configured. The guard work
    // above means the "Not configured" branch is unreachable from the
    // page (absent backends render nothing), but the vocabulary stays
    // correct for any future caller.
    expect(PLATFORM_STATUS).toContain('? "Unavailable"');
    expect(PLATFORM_STATUS).toContain(': "Not configured"');
  });
});
