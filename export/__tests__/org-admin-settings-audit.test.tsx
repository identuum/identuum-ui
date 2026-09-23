import { afterEach, expect, it, vi } from "vitest";
import { addOrganizationDomainAction } from "@/app/org-admin/settings/domains-actions";
import { ORG_ADMIN_DOMAINS_CARD_COPY } from "@/app/org-admin/settings/settings-helpers";
import { everyApiCallThroughTheBoundary, installExport } from "./harness";
import { answers, heading, ORG, page } from "./recorded";

// Plan D: settings and audit as the export renders them — the shared Next
// modules, answered by the OSS binary's recorded GET responses.

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["/org-admin/settings", "Organization settings", "capture.test"],
  ["/org-admin/audit", "Audit log", "service_account.created"],
])("%s renders its heading and its data through the boundary", async (path, title, text) => {
  const { html, redirectedTo, env } = await page(path);
  expect(redirectedTo).toBeNull();
  expect(heading(html, title)).toBe(true);
  expect(html).toContain(text);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it("a domains outage on settings shows the domains load error", async () => {
  const { html } = await page("/org-admin/settings", {
    [`GET /api/v1/organizations/${ORG}/domains`]: { status: 503, json: {} },
  });
  expect(html).toContain(ORG_ADMIN_DOMAINS_CARD_COPY.loadError);
});

it("an audit outage is an error, never an empty log", async () => {
  const { html } = await page("/org-admin/audit", {
    "GET /api/v1/audit/events": { status: 503, json: {} },
  });
  expect(html).toContain("Could not load audit events");
  expect(html).not.toContain("No audit events found.");
});

it("adding a domain posts to the tenant's own organization through /bff", async () => {
  const env = installExport("/org-admin/settings", answers);
  const form = new FormData();
  form.set("domain", "verify.capture.test");
  await addOrganizationDomainAction({ phase: "idle" }, form).catch(() => undefined);
  const write = env.calls.find((c) => c.method === "POST");
  expect(write).toMatchObject({
    path: `/api/v1/organizations/${ORG}/domains`,
    viaBff: true,
    proof: true,
  });
  expect(write?.body).toMatchObject({ domain: "verify.capture.test" });
});
