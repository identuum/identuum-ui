import { afterEach, describe, expect, it, vi } from "vitest";
import { nextProxyFetch } from "../src/next-proxy";
import { installExport } from "./harness";

// UI-0914-MUSTCHANGE-CONSOLE: OSS v0.9.14 (92936bf) sends a provider sign-in
// back to /login?reason=password_change_required or password_expired when the
// member owes the password change an administrator asked for, or holds an
// administrator-set password past its 24 hours. The banner says it plainly.

afterEach(() => vi.unstubAllGlobals());

const READY = {
  "GET /api/v1/component": { json: { product: "identuum-idp-oss" } },
  "GET /api/setup/status": { json: { state: "setup_complete", setup_complete: true } },
};

describe("login: the provider refusals for an administrator-set password", () => {
  it.each([
    [
      "password_change_required",
      "Sign in with the password your administrator gave you and choose a new one.",
    ],
    ["password_expired", "This password has expired. Ask your administrator for a new reset link."],
  ])("?reason=%s shows plain words", async (reason, text) => {
    const env = installExport(`/login?reason=${reason}`, READY);
    vi.stubGlobal("fetch", nextProxyFetch(globalThis.fetch));
    const { html } = await env.render();
    expect(html).toContain('data-testid="login-reason"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(text);
    expect(html).not.toContain(`>${reason}<`);
  });
});
