import { afterEach, describe, expect, it, vi } from "vitest";
import { assignAdminAction } from "@/app/site-admin/organizations/[id]/assign-admin/actions";
import { deactivateOrgAction } from "@/app/site-admin/organizations/[id]/deactivate/actions";
import { deleteOrgAction } from "@/app/site-admin/organizations/[id]/delete/actions";
import { updateOrgAction } from "@/app/site-admin/organizations/[id]/edit/actions";
import { reactivateOrgAction } from "@/app/site-admin/organizations/[id]/reactivate/actions";
import { restoreOrgAction } from "@/app/site-admin/organizations/[id]/restore/actions";
import { createOrgAction } from "@/app/site-admin/organizations/new/actions";
import { ExportRedirect } from "../src/platform/next-navigation";
import { everyApiCallThroughTheBoundary, installExport, type Routes } from "./harness";
import { SITE_ADMIN_SESSION, SITE_ORG, siteAnswers, sitePage } from "./recorded";

// PLAN-D-3: the organizations pages of the site-admin area as the export
// renders them — the shared page and action modules, data through /bff —
// over the OSS binary's recorded answers. Per page: its read, its mutation
// where it has one, and its refusal or failure handling.

afterEach(() => vi.unstubAllGlobals());

const ORG_PATH = `/api/v1/organizations/${SITE_ORG}`;
const recordedOrg = (siteAnswers[`GET ${ORG_PATH}`] as { json: Record<string, unknown> }).json;
const orgWith = (extra: Record<string, unknown>) => ({ json: { ...recordedOrg, ...extra } });
const OTHER = "01990000-0000-7000-8000-0000000000bb";

/** Runs a server action inside an installed export; a redirect resolves to its target. */
async function act<S>(
  routes: Routes,
  run: () => Promise<S>
): Promise<{
  result: S | null;
  redirectedTo: string | null;
  env: ReturnType<typeof installExport>;
}> {
  const env = installExport("/site-admin/organizations", {
    ...siteAnswers,
    "GET /api/v1/validate": SITE_ADMIN_SESSION,
    ...routes,
  });
  try {
    return { result: await run(), redirectedTo: null, env };
  } catch (error) {
    if (error instanceof ExportRedirect) return { result: null, redirectedTo: error.to, env };
    throw error;
  }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** The mutation went through the boundary with the proof, after a validation. */
function throughBoundaryAfterValidate(env: ReturnType<typeof installExport>, method: string) {
  const call = env.calls.find((c) => c.method === method);
  expect(call).toMatchObject({ viaBff: true, proof: true });
  const at = env.calls.indexOf(call as (typeof env.calls)[number]);
  expect(env.calls.slice(0, at).some((c) => c.path === "/api/v1/validate")).toBe(true);
  return call;
}

describe("organizations list", () => {
  it("reads the organizations through the boundary and links each one", async () => {
    const { html, env } = await sitePage("/site-admin/organizations", {
      "GET /api/v1/organizations": {
        json: { organizations: [recordedOrg], total: 1, page: 1, page_size: 25 },
      },
    });
    expect(html).toContain(String(recordedOrg.name));
    expect(html).toContain(`href="/site-admin/organizations/${SITE_ORG}"`);
    expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
  });

  it("an outage is an error state, never an empty list", async () => {
    const { html } = await sitePage("/site-admin/organizations", {
      "GET /api/v1/organizations": { status: 503, json: {} },
    });
    expect(html).toContain("Could not load organizations");
  });

  it("the deleted filter is sent to the IdP", async () => {
    const { env } = await sitePage("/site-admin/organizations?deleted=true");
    const list = env.calls.find((c) => c.path.startsWith("/api/v1/organizations?"));
    expect(list?.path).toContain("deleted=true");
  });
});

describe("new organization", () => {
  it("renders the create form", async () => {
    const { html } = await sitePage("/site-admin/organizations/new");
    for (const name of ["name", "domain", "admin_email"]) expect(html).toContain(`name="${name}"`);
  });

  it("creates through the boundary after a validation", async () => {
    const { result, env } = await act(
      { "POST /api/v1/organizations": { status: 201, json: { organization: recordedOrg } } },
      () =>
        createOrgAction(
          {},
          form({ name: "Created Org", domain: "created.test", admin_email: "a@created.test" })
        )
    );
    const post = throughBoundaryAfterValidate(env, "POST");
    expect(post?.path).toBe("/api/v1/organizations");
    expect(post?.body).toMatchObject({ name: "Created Org", domain: "created.test" });
    expect(result).not.toBeNull();
  });

  it("a taken domain is a field error; invalid input never reaches the IdP", async () => {
    const taken = await act({ "POST /api/v1/organizations": { status: 409, json: {} } }, () =>
      createOrgAction({}, form({ name: "X", domain: "taken.test", admin_email: "a@taken.test" }))
    );
    expect(taken.result).toMatchObject({ fieldErrors: { domain: expect.any(String) } });
    const invalid = await act({}, () =>
      createOrgAction({}, form({ name: "", domain: "", admin_email: "" }))
    );
    expect(invalid.env.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a refusal sends the browser to sign in again", async () => {
    const { redirectedTo } = await act(
      { "POST /api/v1/organizations": { status: 403, json: {} } },
      () => createOrgAction({}, form({ name: "X", domain: "x.test", admin_email: "a@x.test" }))
    );
    expect(redirectedTo).toBe("/login?reason=unauthorized");
  });
});

describe("organization detail", () => {
  it("reads the organization and its administrators through the boundary", async () => {
    const { html, env } = await sitePage(`/site-admin/organizations/${SITE_ORG}`);
    expect(html).toContain(String(recordedOrg.name));
    expect(html).toContain("admin@tenant-b-p3.test");
    const paths = env.calls.map((c) => c.path.split("?")[0]);
    expect(paths).toContain(`${ORG_PATH}/admin-recovery-candidates`);
    expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
  });

  // Protocol settings are a tenant's own resource: every edition refuses
  // site_admin (OSS 403, THE-REMAINING-FOUR; CE's admin model likewise), so
  // the site-admin page shows the refusal without asking for it.
  it("never asks for protocol settings and shows the site administrator's refusal", async () => {
    const { html, env } = await sitePage(`/site-admin/organizations/${SITE_ORG}`);
    const paths = env.calls.map((c) => c.path.split("?")[0]);
    expect(paths).not.toContain(`${ORG_PATH}/protocol-settings`);
    expect(html).toContain(
      "You do not have access to manage this organization&#x27;s protocol settings."
    );
  });

  it.each([403, 404])(
    "a %s (another deployment's record or missing) is the not-found panel",
    async (status) => {
      const { html } = await sitePage(`/site-admin/organizations/${OTHER}`, {
        [`GET /api/v1/organizations/${OTHER}`]: { status, json: {} },
      });
      expect(html).toContain("Organization not found");
    }
  );

  it("a malformed id is not found before any organization request", async () => {
    const { html, env } = await sitePage("/site-admin/organizations/not-a-uuid");
    expect(html).toContain("Organization not found");
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/organizations/"))).toBe(false);
  });
});

describe("edit", () => {
  it("renders the organization's current values", async () => {
    const { html } = await sitePage(`/site-admin/organizations/${SITE_ORG}/edit`);
    expect(html).toContain(`value="${String(recordedOrg.name)}"`);
  });

  it("saves through the boundary and returns to the detail page", async () => {
    const { redirectedTo, env } = await act(
      { [`PUT ${ORG_PATH}`]: orgWith({ name: "Renamed" }) },
      () =>
        updateOrgAction(
          {},
          form({
            org_id: SITE_ORG,
            name: "Renamed",
            active: "true",
            auth_policy: "",
            mfa_policy: "",
          })
        )
    );
    const put = throughBoundaryAfterValidate(env, "PUT");
    expect(put?.path).toBe(ORG_PATH);
    expect(put?.body).toMatchObject({ name: "Renamed" });
    expect(redirectedTo).toBe(`/site-admin/organizations/${SITE_ORG}`);
  });

  it("a missing organization is an error, not a success", async () => {
    const { result } = await act({ [`PUT ${ORG_PATH}`]: { status: 404, json: {} } }, () =>
      updateOrgAction(
        {},
        form({ org_id: SITE_ORG, name: "Renamed", active: "true", auth_policy: "", mfa_policy: "" })
      )
    );
    expect(result).toMatchObject({ error: expect.stringContaining("not found") });
  });
});

describe("assign administrator", () => {
  it("an organization that already has an administrator says so", async () => {
    const { html } = await sitePage(`/site-admin/organizations/${SITE_ORG}/assign-admin`, {
      [`GET ${ORG_PATH}`]: orgWith({ is_claimed: true }),
    });
    expect(html).toContain("Administrator already assigned");
  });

  it("re-sends the activation through the boundary", async () => {
    const { env } = await act(
      { [`POST ${ORG_PATH}/resend-activation`]: { json: { status: "sent" } } },
      () => assignAdminAction({}, form({ org_id: SITE_ORG, admin_email: "b@tenant-b-p3.test" }))
    );
    const post = throughBoundaryAfterValidate(env, "POST");
    expect(post?.path).toBe(`${ORG_PATH}/resend-activation`);
  });
});

describe("deactivate and reactivate", () => {
  it("deactivate asks for confirmation, then PUTs active=false and returns to the list", async () => {
    const unconfirmed = await act({}, () => deactivateOrgAction({}, form({ org_id: SITE_ORG })));
    expect(unconfirmed.result).toMatchObject({ fieldErrors: { confirmed: expect.any(String) } });
    expect(unconfirmed.env.calls.some((c) => c.method === "PUT")).toBe(false);

    const { redirectedTo, env } = await act(
      { [`PUT ${ORG_PATH}`]: orgWith({ active: false }) },
      () => deactivateOrgAction({}, form({ org_id: SITE_ORG, confirmed: "yes" }))
    );
    expect(throughBoundaryAfterValidate(env, "PUT")?.body).toMatchObject({ active: false });
    expect(redirectedTo).toBe("/site-admin/organizations");
  });

  it("reactivate PUTs active=true; a refusal sends the browser to sign in again", async () => {
    const ok = await act({ [`PUT ${ORG_PATH}`]: orgWith({ active: true }) }, () =>
      reactivateOrgAction({}, form({ org_id: SITE_ORG }))
    );
    expect(throughBoundaryAfterValidate(ok.env, "PUT")?.body).toMatchObject({ active: true });
    expect(ok.redirectedTo).toBe("/site-admin/organizations");

    const refused = await act({ [`PUT ${ORG_PATH}`]: { status: 403, json: {} } }, () =>
      reactivateOrgAction({}, form({ org_id: SITE_ORG }))
    );
    expect(refused.redirectedTo).toBe("/login?reason=unauthorized");
  });

  it("the pages name the state they would not change", async () => {
    const active = await sitePage(`/site-admin/organizations/${SITE_ORG}/reactivate`);
    expect(active.html).toContain("Already active");
    const inactive = await sitePage(`/site-admin/organizations/${SITE_ORG}/deactivate`, {
      [`GET ${ORG_PATH}`]: orgWith({ active: false }),
    });
    expect(inactive.html).toContain("Already inactive");
  });
});

describe("delete and restore", () => {
  it("delete asks for confirmation, then DELETEs through the boundary and shows the deleted list", async () => {
    const { redirectedTo, env } = await act({ [`DELETE ${ORG_PATH}`]: { status: 204 } }, () =>
      deleteOrgAction({}, form({ org_id: SITE_ORG, confirmed: "yes" }))
    );
    expect(throughBoundaryAfterValidate(env, "DELETE")?.path).toBe(ORG_PATH);
    expect(redirectedTo).toBe("/site-admin/organizations?deleted=true");
  });

  it("restore POSTs through the boundary; a missing organization is an error", async () => {
    const ok = await act({ [`POST ${ORG_PATH}/restore`]: { json: recordedOrg } }, () =>
      restoreOrgAction({}, form({ org_id: SITE_ORG }))
    );
    expect(throughBoundaryAfterValidate(ok.env, "POST")?.path).toBe(`${ORG_PATH}/restore`);
    expect(ok.redirectedTo).toBe("/site-admin/organizations?deleted=false");

    const missing = await act({ [`POST ${ORG_PATH}/restore`]: { status: 404, json: {} } }, () =>
      restoreOrgAction({}, form({ org_id: SITE_ORG }))
    );
    expect(missing.result).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("a deleted organization, which OSS will not read by id, is found among the deleted rows through the boundary", async () => {
    // ORG-RESTORE-1: OSS answers GET /:id 404 for a soft-deleted organization
    // and marks the row with deleted_at; main's v0.2.4 restore page reads it
    // from the deleted list instead.
    const deletedRow = { ...recordedOrg, id: SITE_ORG, deleted_at: "2026-09-24T00:00:00Z" };
    const { html, env } = await sitePage(`/site-admin/organizations/${SITE_ORG}/restore`, {
      [`GET ${ORG_PATH}`]: { status: 404, json: { error: "not found" } },
      "GET /api/v1/organizations": {
        json: { organizations: [deletedRow], total: 1, page: 1, page_size: 100 },
      },
    });
    expect(html).toContain("Restore organization");
    expect(html).toContain(`value="${SITE_ORG}"`);
    const list = env.calls.find((c) => c.path.startsWith("/api/v1/organizations?"));
    expect(list).toMatchObject({ viaBff: true, proof: true });
    expect(list?.path).toContain("deleted=true");
  });

  it("the pages name the state they would not change", async () => {
    const live = await sitePage(`/site-admin/organizations/${SITE_ORG}/restore`);
    expect(live.html).toContain("Not deleted");
    const gone = await sitePage(`/site-admin/organizations/${SITE_ORG}/delete`, {
      [`GET ${ORG_PATH}`]: orgWith({ deleted: true }),
    });
    expect(gone.html).toContain("Already deleted");
  });
});
