/**
 * OSS-RC: frictions the new-operator walk hit on the v0.7.0 candidate.
 *
 * 1. /activate answered "not available on this installation" on a default
 *    no-SMTP OSS install: it was gated on mail_ceremonies, but the org
 *    activation is redeemed from a HANDED-OVER link with or without mail
 *    (D-016). OSS declares activation_link; CE declares neither and keeps
 *    calling nothing.
 * 2. The setup wizard told the operator to run `identuum-idp
 *    --show-setup-code <data-dir>`, which exits 2 ("flag provided but not
 *    defined"); the command is the show-setup-code subcommand.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let capabilities: Record<string, boolean> = {};
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities }, ag: null },
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

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response('{"error":"invalid_token"}', { status: 400 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const token = { searchParams: Promise.resolve({ token: "t".repeat(64) }) };
const activate = async () =>
  renderToStaticMarkup(
    (await (await import("../app/activate/page")).default(token)) as React.ReactElement
  );

describe("the activation link is offered where the IdP serves it, mail or not", () => {
  it("OSS without SMTP (mail_ceremonies false, activation_link true) validates the link", async () => {
    capabilities = { mail_ceremonies: false, activation_link: true };
    const html = await activate();
    expect(html).not.toContain("not available on this installation");
    expect(fetchSpy).toHaveBeenCalled();
  });
  it("CE (no mail, no activation_link) still calls nothing", async () => {
    capabilities = { mail_ceremonies: false, admin_reset_link: true };
    const html = await activate();
    expect(html).toContain("not available on this installation");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("discovery keeps the activation_link key", async () => {
    const { extractCapabilities } = await import("../lib/runtime-composition");
    expect(extractCapabilities({ activation_link: true })).toEqual({ activation_link: true });
  });
});

describe("the setup wizard names a command that runs", () => {
  it("show-setup-code is a subcommand, not a flag", () => {
    const src = readFileSync(resolve(__dirname, "..", "app/setup/setup-wizard.tsx"), "utf8");
    expect(src).not.toContain("--show-setup-code");
    expect(src).toContain("show-setup-code &lt;data-dir&gt;");
  });
});
