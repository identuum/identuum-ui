import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRuntimeConfig, fetchStatus } from "@/lib/ui-api";
import { isServerRoute } from "../src/server-routes";
import { installExport } from "./harness";
import { SITE_ADMIN_SESSION, siteAnswers, sitePage } from "./recorded";

// PLAN-D-4: the site-admin overview and settings pages in the export. The
// overview reads the UI routes GET /api/status and GET /api/runtime-config
// (in the browser, after mount); settings probes the IdP at GET /healthz
// (during the render). The binary serves all three since PLAN-D-4, in the
// Next routes' shapes; they are reached directly, never through /bff.

afterEach(() => vi.unstubAllGlobals());

const OSS_STATUS = {
  idp: { enabled: true, healthy: true, product: "identuum-idp-oss" },
  ag: { enabled: false, healthy: null, product: "identuum-ag" },
};
const OSS_RUNTIME_CONFIG = {
  configured: true,
  ui_origin: "http://localhost:7113",
  idp: { enabled: true, public_base_url: "http://localhost:7113" },
  ag: { enabled: false, public_base_url: "" },
};
const HEALTHY = { json: { status: "healthy", mode: "oss", tier: "starter" } };

describe("overview", () => {
  it("is routed through the shared layout and page", async () => {
    expect(isServerRoute("/site-admin")).toBe(true);
    const { html, redirectedTo } = await sitePage("/site-admin");
    expect(redirectedTo).toBeNull();
    expect(html).toContain(">Overview</h1>");
    expect(html).toContain('href="/site-admin/organizations"');
  });

  it("its two reads go to the binary's own UI routes, directly and not through /bff", async () => {
    const env = installExport("/site-admin", {
      ...siteAnswers,
      "GET /api/v1/validate": SITE_ADMIN_SESSION,
      "GET /api/status": { json: OSS_STATUS },
      "GET /api/runtime-config": { json: OSS_RUNTIME_CONFIG },
    });
    expect(await fetchStatus()).toEqual(OSS_STATUS);
    expect(await fetchRuntimeConfig()).toEqual(OSS_RUNTIME_CONFIG);
    const direct = env.calls.filter(
      (c) => c.path === "/api/status" || c.path === "/api/runtime-config"
    );
    expect(direct.map((c) => c.viaBff)).toEqual([false, false]);
  });
});

describe("settings", () => {
  it("is routed, and reports the IdP healthy from the binary's /healthz", async () => {
    expect(isServerRoute("/site-admin/settings")).toBe(true);
    const { html, env } = await sitePage("/site-admin/settings", { "GET /healthz": HEALTHY });
    expect(html).toContain(">Settings</h1>");
    expect(html).toContain("Healthy");
    expect(html).not.toContain("Unhealthy");
    expect(env.calls.find((c) => c.path === "/healthz")).toMatchObject({ viaBff: false });
  });

  it("a /healthz that is not OK is Unhealthy, never Healthy", async () => {
    const { html } = await sitePage("/site-admin/settings", {
      "GET /healthz": { status: 503, json: { status: "not_serving", mode: "oss" } },
    });
    expect(html).toContain("Unhealthy");
  });
});
