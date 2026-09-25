/**
 * Owner decision 5 (2026-09-25, corrected): the UI shows no surface that no
 * edition serves, and session revoke asks only the route its edition serves.
 *
 * Measured against identuum-idp-oss v0.6.0 and identuum-idp-ce 635549e:
 *   - report exports (/api/v1/reports/*, 10 paths): served by neither;
 *   - the organization webhooks list (GET /api/v1/organizations/:id/webhooks):
 *     served by neither;
 *   - passkey rename (PATCH /api/v1/webauthn/credentials/:id): served by
 *     neither (OSS serves DELETE only);
 *   - session revoke: OSS POST /api/v1/revoke {session_id}, CE POST
 *     /api/v1/sessions/{id}/revoke — each served, by one edition each.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: Array<{ url: string; method: string; body: unknown }> = [];
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body: init.body });
    return new Response(null, { status: 204 });
  }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

afterEach(() => {
  calls.length = 0;
});

const ROOT = resolve(__dirname, "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf-8");

describe("session revoke asks only its edition's route", () => {
  it("OSS: exactly one request, POST /api/v1/revoke with the session id in the body", async () => {
    const { revokeSessionById } = await import("../lib/idp-account-client");
    const r = await revokeSessionById("sid-1", "oss");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "http://idp.test/api/v1/revoke", method: "POST" });
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ session_id: "sid-1" });
  });

  it("CE: exactly one request, POST /api/v1/sessions/{id}/revoke", async () => {
    const { revokeSessionById } = await import("../lib/idp-account-client");
    const r = await revokeSessionById("sid-1", "ce");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "http://idp.test/api/v1/sessions/sid-1/revoke",
      method: "POST",
    });
  });
});

describe("surfaces no edition serves are gone", () => {
  it("the reports page offers no report export link", async () => {
    const { default: Page } = await import("../app/site-admin/reports/page");
    const html = renderToStaticMarkup(Page());
    expect(html).not.toContain("/api/v1/reports/");
    expect(html).not.toMatch(/<a\b/);
  });

  it("no UI code requests the organization webhooks list", () => {
    expect(read("lib", "idp-admin-client.ts")).not.toContain("/webhooks");
    expect(read("app", "org-admin", "settings", "page.tsx")).not.toMatch(/webhook/i);
  });

  it("passkeys offer no rename (no PATCH, no Rename control)", () => {
    const src = read("components", "ui", "passkey-section.tsx");
    expect(src).not.toContain('method: "PATCH"');
    expect(src).not.toMatch(/>\s*Rename\s*</);
  });
});
