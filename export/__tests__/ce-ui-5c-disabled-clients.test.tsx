import { afterEach, expect, it, vi } from "vitest";
import { APP, answers, idOf, page } from "./recorded";

// CE-UI-5c: the console the binaries embed renders a client the IdP reports
// disabled (identuum-idp-ce: carried disabled by the OSS upgrade) with a
// Disabled badge and without Edit application; the recorded OSS answers, which
// omit the field, render as before.

afterEach(() => {
  vi.unstubAllGlobals();
});

const detailKey = `GET /api/v1/clients/${idOf(APP)}`;
const recordedClient = (answers[detailKey] as { json: Record<string, unknown> }).json;

it("the applications list badges a disabled client", async () => {
  const { html } = await page("/org-admin/applications", {
    "GET /api/v1/clients": {
      status: 200,
      json: { clients: [{ ...recordedClient, disabled: true }], total: 1, page: 1, page_size: 50 },
    },
  });
  expect(html).toContain("Disabled");
});

it("a disabled application shows Disabled and offers no edit", async () => {
  const { html } = await page(APP, {
    [detailKey]: { status: 200, json: { ...recordedClient, disabled: true } },
  });
  expect(html).toContain("Disabled");
  expect(html).not.toContain("Edit application");
});

it("an IdP that omits disabled renders the application as before", async () => {
  const { html } = await page(APP);
  expect(html).not.toContain(">Disabled<");
  expect(html).toContain("Edit application");
});
