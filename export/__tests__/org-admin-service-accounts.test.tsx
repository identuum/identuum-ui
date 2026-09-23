import { afterEach, expect, it, vi } from "vitest";
import { disableServiceAccountAction } from "@/app/org-admin/service-accounts/actions";
import { everyApiCallThroughTheBoundary, installExport } from "./harness";
import { answers, heading, idOf, ORG, page, SA } from "./recorded";

// Plan D: the three service-account pages as the export renders them — the
// shared Next modules, answered by the OSS binary's recorded GET responses.

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["/org-admin/service-accounts", "Service accounts", "captured-sa"],
  [SA, "captured-sa", "Disable service account"],
  ["/org-admin/service-accounts/new", "Create service account", "Name"],
])("%s renders its heading and its data through the boundary", async (path, title, text) => {
  const { html, redirectedTo, env } = await page(path);
  expect(redirectedTo).toBeNull();
  expect(heading(html, title)).toBe(true);
  expect(html).toContain(text);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it("a refused service-account read shows Access denied, not the account", async () => {
  const { html } = await page(SA, {
    [`GET /api/v1/organizations/${ORG}/service-accounts`]: { status: 403, json: { error: "x" } },
  });
  expect(html).toContain("Access denied");
  expect(html).not.toContain("Disable service account");
});

it("a service-accounts-list outage is an error, never an empty list", async () => {
  const { html } = await page("/org-admin/service-accounts", {
    [`GET /api/v1/organizations/${ORG}/service-accounts`]: { status: 503, json: {} },
  });
  expect(html).toContain("Could not load service accounts");
  expect(html).not.toContain("No service accounts yet");
});

it("disabling a service account posts through /bff after the typed DISABLE", async () => {
  const env = installExport(SA, answers);
  const form = new FormData();
  form.set("confirm", "DISABLE");
  // Any lifecycle answer: the proof is the request the shared action sends.
  await disableServiceAccountAction(idOf(SA), { phase: "idle" }, form).catch(() => undefined);
  const write = env.calls.find((c) => c.method !== "GET");
  expect(write?.path).toContain(idOf(SA));
  expect(write).toMatchObject({ viaBff: true, proof: true });
});

it("a missing DISABLE confirmation never reaches the server", async () => {
  const env = installExport(SA, answers);
  const form = new FormData();
  form.set("confirm", "disable please");
  const state = await disableServiceAccountAction(idOf(SA), { phase: "idle" }, form);
  expect(state.phase).toBe("error");
  expect(env.calls.some((c) => c.method !== "GET")).toBe(false);
});
