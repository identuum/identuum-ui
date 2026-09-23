import { afterEach, expect, it, vi } from "vitest";
import { deleteApplicationAction } from "@/app/org-admin/applications/actions";
import { ExportRedirect } from "../src/platform/next-navigation";
import { everyApiCallThroughTheBoundary, installExport } from "./harness";
import { APP, answers, heading, idOf, page } from "./recorded";

// Plan D: the four applications pages as the export renders them — the shared
// Next modules, answered by the OSS binary's recorded GET responses.

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["/org-admin/applications", "Applications", "Captured app"],
  [APP, "Captured app", "https://rp.example.test/callback"],
  [`${APP}/edit`, "Edit Captured app", "Save application"],
  ["/org-admin/applications/new", "Create application", "Redirect URIs"],
])("%s renders its heading and its data through the boundary", async (path, title, text) => {
  const { html, redirectedTo, env } = await page(path);
  expect(redirectedTo).toBeNull();
  expect(heading(html, title)).toBe(true);
  expect(html).toContain(text);
  expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
});

it.each([
  [404, "Application not found"],
  [403, "Access denied"],
])("an application answered %i shows %s", async (status, text) => {
  const { html } = await page(APP, {
    [`GET /api/v1/clients/${idOf(APP)}`]: { status, json: { error: "x" } },
  });
  expect(html).toContain(text);
  expect(html).not.toContain("https://rp.example.test/callback");
});

it("an applications-list outage is an error, never an empty list", async () => {
  const { html } = await page("/org-admin/applications", {
    "GET /api/v1/clients": { status: 503, json: {} },
  });
  expect(html).toContain("Could not load applications");
  expect(html).not.toContain("No applications yet");
});

it("deleting an application sends DELETE through /bff and redirects to the list", async () => {
  const env = installExport(APP, {
    ...answers,
    [`DELETE /api/v1/clients/${idOf(APP)}`]: { status: 204 },
  });
  const clientId = (answers[`GET /api/v1/clients/${idOf(APP)}`] as { json: { client_id: string } })
    .json.client_id;
  const form = new FormData();
  form.set("confirm", "Captured app");
  const outcome = await deleteApplicationAction(
    idOf(APP),
    "Captured app",
    clientId,
    { phase: "idle" },
    form
  ).catch((e: unknown) => e);
  expect(outcome).toBeInstanceOf(ExportRedirect);
  expect((outcome as ExportRedirect).to).toBe("/org-admin/applications?deleted=Captured%20app");
  expect(env.calls.find((c) => c.method === "DELETE")).toMatchObject({
    path: `/api/v1/clients/${idOf(APP)}`,
    viaBff: true,
    proof: true,
  });
});

it("a mistyped confirmation never reaches the server", async () => {
  const env = installExport(APP, answers);
  const form = new FormData();
  form.set("confirm", "not the name");
  const state = await deleteApplicationAction(
    idOf(APP),
    "Captured app",
    "x",
    { phase: "idle" },
    form
  );
  expect(state.phase).toBe("error");
  expect(env.calls.some((c) => c.method === "DELETE")).toBe(false);
});
