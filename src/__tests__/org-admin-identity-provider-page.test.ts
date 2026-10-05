/**
 * v0.9.7 (the v0.9.6 open item): a console page for the organization's
 * upstream OIDC provider, matching docs/guides/oidc-upstream-login.md in
 * identuum-idp-oss. Before, the only way was the API. Synthetic responses
 * only; the secret in these tests is a placeholder.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: {
      enabled: true,
      public_base_url: "http://idp.test",
      internal_base_url: "http://idp.test",
    },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

import { providerCallbackUrl } from "../app/org-admin/identity-provider/provider-form";
import {
  deleteOrgOidcProvider,
  getOrgOidcProvider,
  saveOrgOidcProvider,
} from "../lib/idp-admin-client";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
function serverAnswers(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const wire = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Example SSO",
  slug: "example-sso",
  type: "oidc",
  active: true,
  config: {
    issuer_url: "https://accounts.example",
    client_id: "cid",
    client_secret: "MUST-NOT-SURFACE",
    scopes: ["openid", "email"],
    email_domains: ["example.com"],
    allow_external_domains: false,
  },
};

const input = {
  name: "Example SSO",
  slug: "example-sso",
  issuer_url: "https://accounts.example",
  client_id: "cid",
  client_secret: "",
  scopes: ["openid", "email", "profile"],
  email_domains: ["example.com"],
  allow_external_domains: false,
};

describe("the organization's OIDC provider, through the API the guide documents", () => {
  it("reads the provider and never carries a secret", async () => {
    serverAnswers(200, { success: true, identity_provider: wire });
    const r = await getOrgOidcProvider("org-1");
    if (!r.ok || !r.provider) throw new Error("expected a provider");
    expect(r.provider.issuer_url).toBe("https://accounts.example");
    expect(r.provider.email_domains).toEqual(["example.com"]);
    expect(JSON.stringify(r.provider)).not.toContain("MUST-NOT-SURFACE");
  });

  it("no provider is null, not an error", async () => {
    serverAnswers(200, { success: true, identity_provider: null });
    expect(await getOrgOidcProvider("org-1")).toEqual({ ok: true, provider: null });
  });

  it("create POSTs type oidc with the secret inside config", async () => {
    const calls = serverAnswers(201, { success: true, identity_provider: wire });
    const r = await saveOrgOidcProvider("org-1", { ...input, client_secret: "s3" }, "create");
    expect(r.ok).toBe(true);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://idp.test/api/v1/organizations/org-1/identity-provider");
    expect(calls[0].body).toMatchObject({ type: "oidc", slug: "example-sso" });
    expect(calls[0].body).toMatchObject({ config: { client_secret: "s3" } });
  });

  it("update PUTs and leaves an empty secret out, so the stored one stays", async () => {
    const calls = serverAnswers(200, { success: true, identity_provider: wire });
    await saveOrgOidcProvider("org-1", input, "update");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body?.config).not.toHaveProperty("client_secret");
  });

  it("a refusal shows the IdP's sentence", async () => {
    serverAnswers(409, { error: "an OIDC provider already exists for this organization" });
    const r = await saveOrgOidcProvider("org-1", input, "create");
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      error: "an OIDC provider already exists for this organization",
    });
  });

  it("delete calls DELETE", async () => {
    const calls = serverAnswers(200, { success: true, message: "identity provider deleted" });
    expect(await deleteOrgOidcProvider("org-1")).toEqual({ ok: true });
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("the page", () => {
  const dir = resolve(__dirname, "../app/org-admin/identity-provider");
  const form = readFileSync(resolve(dir, "provider-form.tsx"), "utf8");
  const actions = readFileSync(resolve(dir, "actions.ts"), "utf8");

  it("shows the guide's redirect URI", () => {
    expect(providerCallbackUrl("https://idp.example/", "p1")).toBe(
      "https://idp.example/api/v1/auth/idp/p1/callback"
    );
  });

  it("never pre-fills the client secret", () => {
    expect(form).toMatch(/name="client_secret"\s+type="password"/);
    expect(form).not.toMatch(/defaultValue=\{provider\?\.client_secret/);
  });

  it("refuses a configuration that could sign nobody in", () => {
    expect(actions).toContain("List at least one email domain, or allow every domain.");
  });

  it("the settings page links to it", () => {
    const sections = readFileSync(
      resolve(__dirname, "../app/org-admin/settings/settings-readonly-sections.tsx"),
      "utf8"
    );
    expect(sections).toContain('href="/org-admin/identity-provider"');
  });
});
