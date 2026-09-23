import { afterEach, describe, expect, it, vi } from "vitest";
import { OSS_COMPONENT } from "./harness";
import { siteAnswers, sitePage } from "./recorded";

// PLAN-D-3: the site-admin observability pages (audit, anomaly, keys, system,
// runtime info, admin sessions, audit chain) as the export renders them, over
// the OSS binary's recorded answers. Each page's read, and each branch it
// distinguishes: forbidden, a capability this deployment does not serve, and
// a generic failure (5xx or unreachable) — never an empty success.

afterEach(() => vi.unstubAllGlobals());

const outage = { status: 503, json: {} };
const forbidden = { status: 403, json: { error: "forbidden" } };
const notLicensed = { status: 402, json: { error: "not_licensed" } };

describe("audit", () => {
  it("reads the audit events through the boundary", async () => {
    const { html, env } = await sitePage("/site-admin/audit");
    expect(html).toContain("user_session.login.mfa_enrolled");
    const read = env.calls.find((c) => c.path.startsWith("/api/v1/audit/events"));
    expect(read).toMatchObject({ viaBff: true, proof: true });
  });

  it.each([
    ["an outage", outage, "Could not load audit events"],
    ["a refusal", forbidden, "Access denied"],
    ["an unlicensed feature", notLicensed, "Audit log requires Enterprise/CE"],
  ])("%s is named, never an empty log", async (_n, answer, text) => {
    const { html } = await sitePage("/site-admin/audit", { "GET /api/v1/audit/events": answer });
    expect(html).toContain(text);
    expect(html).not.toContain("No audit events found");
  });
});

describe("anomaly", () => {
  it("OSS serves no anomaly routes: both cards name the Enterprise/CE boundary", async () => {
    const { html, env } = await sitePage("/site-admin/anomaly");
    expect(html).toContain("Anomaly statistics require Enterprise/CE");
    expect(html).toContain("Anomaly events require Enterprise/CE");
    expect(env.calls.map((c) => c.path.split("?")[0])).toEqual(
      expect.arrayContaining(["/api/v1/anomaly/stats", "/api/v1/anomaly/events"])
    );
  });

  it.each([
    ["an outage", outage, "Could not load anomaly statistics"],
    ["a refusal", forbidden, "Access denied"],
  ])("%s is named", async (_n, answer, text) => {
    const { html } = await sitePage("/site-admin/anomaly", {
      "GET /api/v1/anomaly/stats": answer,
      "GET /api/v1/anomaly/events": answer,
    });
    expect(html).toContain(text);
  });
});

describe("signing keys", () => {
  it("reads the keys through the boundary", async () => {
    const { html, env } = await sitePage("/site-admin/keys");
    expect(html).toContain("eddsa-20260923-215426");
    expect(env.calls.find((c) => c.path === "/api/v1/keys")).toMatchObject({ viaBff: true });
  });

  it.each([
    ["an outage", outage, "Could not load signing keys"],
    ["a refusal", forbidden, "Access denied"],
  ])("%s is named, never an empty key list", async (_n, answer, text) => {
    const { html } = await sitePage("/site-admin/keys", { "GET /api/v1/keys": answer });
    expect(html).toContain(text);
    expect(html).not.toContain("No signing keys recorded");
  });
});

describe("system", () => {
  it("marks the audit chain commercial where the binary reports audit_chain false", async () => {
    const { html } = await sitePage("/site-admin/system");
    expect(html).toContain('data-testid="system-card-commercial-audit-chain"');
  });

  it("follows the capability map: a deployment reporting audit_chain true shows it as available", async () => {
    const withChain = {
      ...OSS_COMPONENT,
      capabilities: { ...OSS_COMPONENT.capabilities, audit_chain: true },
    };
    const { html } = await sitePage("/site-admin/system", {
      "GET /api/v1/component": { json: withChain },
    });
    expect(html).not.toContain('data-testid="system-card-commercial-audit-chain"');
  });
});

describe("runtime info", () => {
  it("reads /api/v1/health/details through the boundary", async () => {
    const { html, env } = await sitePage("/site-admin/system/info");
    expect(html).toContain("identuum-idp-oss 0.5.0");
    expect(env.calls.find((c) => c.path === "/api/v1/health/details")).toMatchObject({
      viaBff: true,
      proof: true,
    });
  });

  it.each([
    ["an outage", outage, "Could not load runtime info"],
    ["a refusal", forbidden, "Access denied"],
  ])("%s is named", async (_n, answer, text) => {
    const { html } = await sitePage("/site-admin/system/info", {
      "GET /api/v1/health/details": answer,
    });
    expect(html).toContain(text);
  });
});

describe("admin sessions", () => {
  it("OSS serves no admin-session route: the Enterprise/CE boundary is named", async () => {
    const { html } = await sitePage("/site-admin/system/sessions");
    expect(html).toContain("Admin sessions require Enterprise/CE");
  });

  it.each([
    ["an outage", outage, "Could not load system sessions"],
    ["a refusal", forbidden, "Access denied"],
  ])("%s is named", async (_n, answer, text) => {
    const { html } = await sitePage("/site-admin/system/sessions", {
      "GET /api/v1/system/sessions": answer,
    });
    expect(html).toContain(text);
  });
});

describe("audit chain", () => {
  it("OSS reports audit_chain false: the boundary is named and no verification is requested", async () => {
    const { html, env } = await sitePage("/site-admin/system/audit-chain?verify=true");
    expect(html).toContain("Audit chain verification requires Enterprise/CE");
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/system/audit/chain"))).toBe(false);
  });

  it("where the capability is served, ?verify=true verifies through the boundary", async () => {
    const withChain = {
      ...OSS_COMPONENT,
      capabilities: { ...OSS_COMPONENT.capabilities, audit_chain: true },
    };
    const { env } = await sitePage("/site-admin/system/audit-chain?verify=true", {
      "GET /api/v1/component": { json: withChain },
      "GET /api/v1/system/audit/chain/verify": { json: { valid: true } },
    });
    expect(env.calls.find((c) => c.path === "/api/v1/system/audit/chain/verify")).toMatchObject({
      viaBff: true,
      proof: true,
    });
  });
});

it("the recorded answers are the OSS binary's own", () => {
  expect(siteAnswers["GET /api/v1/system/sessions"]).toMatchObject({ status: 404 });
  expect(siteAnswers["GET /api/v1/anomaly/stats"]).toMatchObject({ status: 404 });
});
