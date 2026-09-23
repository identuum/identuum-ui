import { afterEach, expect, it, vi } from "vitest";
import { deleteApiResourceAction } from "@/app/org-admin/api-resources/actions";
import { ExportRedirect } from "../src/platform/next-navigation";
import { everyApiCallThroughTheBoundary, installExport } from "./harness";
import { API, answers, heading, idOf, page } from "./recorded";

// Plan D: the four API-resource pages as the export renders them — the shared
// Next modules, answered by the OSS binary's recorded GET responses.

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["/org-admin/api-resources", "API resources", "Captured API"],
  [API, "Captured API", "https://api.captured.example.test"],
  [`${API}/edit`, "Edit Captured API", "Captured API"],
  ["/org-admin/api-resources/new", "Create API resource", "Audience"],
])("%s renders its heading and its data through the boundary", async (path, title, text) => {
  const { html, redirectedTo, env } = await page(path);
  expect(redirectedTo).toBeNull();
  expect(heading(html, title)).toBe(true);
  expect(html).toContain(text);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it.each([
  [404, "API resource not found"],
  [403, "Access denied"],
])("an API resource answered %i shows %s", async (status, text) => {
  const { html } = await page(API, {
    [`GET /api/v1/api-resources/${idOf(API)}`]: { status, json: { error: "x" } },
  });
  expect(html).toContain(text);
  expect(html).not.toContain("https://api.captured.example.test");
});

it("an API-resources-list outage is an error, never an empty list", async () => {
  const { html } = await page("/org-admin/api-resources", {
    "GET /api/v1/api-resources": { status: 503, json: {} },
  });
  expect(html).toContain("Could not load API resources");
  expect(html).not.toContain("No API resources yet");
});

it("deleting an API resource sends DELETE through /bff and redirects to the list", async () => {
  const env = installExport(API, {
    ...answers,
    [`DELETE /api/v1/api-resources/${idOf(API)}`]: { status: 204 },
  });
  const audience = (
    answers[`GET /api/v1/api-resources/${idOf(API)}`] as { json: { audience?: string } }
  ).json.audience;
  const form = new FormData();
  form.set("confirm", "Captured API");
  const outcome = await deleteApiResourceAction(
    idOf(API),
    "Captured API",
    audience ?? "",
    { phase: "idle" },
    form
  ).catch((e: unknown) => e);
  expect(outcome).toBeInstanceOf(ExportRedirect);
  expect(env.calls.find((c) => c.method === "DELETE")).toMatchObject({
    path: `/api/v1/api-resources/${idOf(API)}`,
    viaBff: true,
    proof: true,
  });
});
