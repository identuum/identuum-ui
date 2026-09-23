import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import Page from "@/app/org-admin/users/[id]/page";
import { getOrgUserById } from "@/lib/idp-admin-client";

afterEach(() => vi.unstubAllGlobals());

it.each([429, 500, 503])("does not collapse user-detail HTTP %s into absence", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status }))
  );
  await expect(getOrgUserById("01990000-0000-7000-8000-000000000002")).rejects.toMatchObject({
    status,
  });
});

it("does not collapse a network failure into absence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network fixture")));
  await expect(getOrgUserById("01990000-0000-7000-8000-000000000002")).rejects.toMatchObject({
    status: null,
  });
});

it("renders resource unavailability in place in the Next page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 }))
  );
  const element = await Page({
    params: Promise.resolve({ id: "01990000-0000-7000-8000-000000000002" }),
  });
  const html = renderToStaticMarkup(element);
  expect(html).toContain('data-testid="user-unavailable"');
  expect(html).not.toContain("User not found");
});
