import { afterEach, expect, it, vi } from "vitest";
import {
  deleteOidcProviderAction,
  saveOidcProviderAction,
} from "@/app/org-admin/identity-provider/actions";
import { everyApiCallThroughTheBoundary, installExport, session } from "./harness";
import { answers, heading, ORG, page } from "./recorded";

const PATH = "/org-admin/identity-provider";
const API = `/api/v1/organizations/${ORG}/identity-provider`;
const provider = {
  id: "01990000-0000-7000-8000-000000000010",
  name: "Export provider",
  slug: "export-provider",
  active: true,
  config: {
    issuer_url: "https://issuer.example.test",
    client_id: "export-client",
    scopes: ["openid", "email"],
    email_domains: ["capture.test"],
  },
};

afterEach(() => vi.unstubAllGlobals());

it("mounts the Settings link destination with the shared provider page and metadata", async () => {
  const settings = await page("/org-admin/settings");
  expect(settings.html).toContain(`href="${PATH}"`);
  const { html, redirectedTo, env } = await page(PATH);
  expect(redirectedTo).toBeNull();
  expect(heading(html, "Sign-in provider")).toBe(true);
  expect(html).toContain("Save provider");
  expect(document.title).toBe("Sign-in provider — Identuum Org Admin");
  expect(env.calls.some((call) => call.path === API)).toBe(true);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it("loads the saved provider without a pre-filled secret", async () => {
  const { html } = await page(PATH, { [`GET ${API}`]: { json: { identity_provider: provider } } });
  expect(html).toContain('value="Export provider"');
  expect(html).toMatch(/name="client_secret"[^>]*value=""/);
  expect(html).toContain("provider-callback");
});

it("creates, updates with an empty secret, reloads and deletes through the existing adapter", async () => {
  let saved: typeof provider | null = null;
  const env = installExport(PATH, {
    ...answers,
    [`GET ${API}`]: () => ({ status: saved ? 200 : 404, json: { identity_provider: saved } }),
    [`POST ${API}`]: () => {
      saved = provider;
      return { json: { identity_provider: saved } };
    },
    [`PUT ${API}`]: () => ({ json: { identity_provider: saved } }),
    [`DELETE ${API}`]: () => {
      saved = null;
      return { status: 204 };
    },
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    name: provider.name,
    slug: provider.slug,
    issuer_url: provider.config.issuer_url,
    client_id: provider.config.client_id,
    client_secret: "disposable-provider-fixture",
    email_domains: "capture.test",
  }))
    form.set(key, value);
  const created = await saveOidcProviderAction({ phase: "idle" }, form);
  expect(created.phase).toBe("saved");
  expect(JSON.stringify(created).includes("client_secret")).toBe(false);
  expect(JSON.stringify(created).includes("disposable-provider-fixture")).toBe(false);
  const loaded = await env.render();
  expect(loaded.html).toContain('value="Export provider"');
  expect(loaded.html.includes("disposable-provider-fixture")).toBe(false);
  form.set("mode", "update");
  form.set("client_secret", "");
  expect((await saveOidcProviderAction({ phase: "idle" }, form)).phase).toBe("saved");
  const update = env.calls.find((call) => call.method === "PUT");
  expect(update?.body).toMatchObject({ config: { client_id: "export-client" } });
  expect(JSON.stringify(update?.body).includes("client_secret")).toBe(false);
  expect((await deleteOidcProviderAction({ phase: "idle" }, new FormData())).phase).toBe("deleted");
  expect((await env.render()).html).toContain("Save provider");
  expect(env.calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual([
    "POST",
    "PUT",
    "DELETE",
  ]);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it.each(["site_admin", "org_user"])("refuses %s at the page and both actions", async (role) => {
  const env = installExport(PATH, {
    ...answers,
    "GET /api/v1/validate": { json: session(role) },
  });
  expect((await env.render()).redirectedTo).not.toBeNull();
  await expect(saveOidcProviderAction({ phase: "idle" }, new FormData())).rejects.toThrow();
  await expect(deleteOidcProviderAction({ phase: "idle" }, new FormData())).rejects.toThrow();
  expect(env.calls.some((call) => call.path === API)).toBe(false);
});
