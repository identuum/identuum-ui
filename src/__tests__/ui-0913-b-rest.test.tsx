/**
 * UI-0913-B (after OSS-0913-B): the Applications tab keeps the "Access
 * removed" line after the list is re-read without the app (review F1), the
 * user page says when a person must choose a new password (OSS
 * requires_password_change), and a 409 from organization create carries its
 * code to the form (review F2; the codes come from OSS-0913-C).
 * SECURITY: every value is a fixture; no reset URL, token or cookie appears.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { phase: "idle" } as unknown,
  createOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));
const idpFetch = vi.fn();
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: (...args: unknown[]) => idpFetch(...args),
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  idpFetch.mockReset();
  h.createOrganization.mockReset();
  h.state = { phase: "idle" };
  vi.doUnmock("@/lib/idp-admin-client");
  vi.resetModules();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const example = {
  clientId: "app-1",
  name: "Example App",
  scopes: ["email"],
  firstGrantedAt: "2026-10-01T10:00:00Z",
};
const second = {
  clientId: "app-2",
  name: "Second App",
  scopes: ["profile"],
  firstGrantedAt: "2026-10-02T10:00:00Z",
};
const list = (consents: (typeof example)[]) => ({
  ok: true as const,
  consents,
  accessTokenLifetimeSeconds: 900,
});

async function section(consents: (typeof example)[]) {
  const { ApplicationsSection } = await import("../app/account/settings/applications-section");
  return renderToStaticMarkup(<ApplicationsSection result={list(consents)} />);
}

/** The text of the one role=status element, and whether it sits inside a row. */
function statusOf(html: string): { text: string; insideRow: boolean } {
  const m = html.match(/<p[^>]*role="status"[^>]*>([^<]*)<\/p>/);
  if (!m || m.index === undefined) throw new Error("no role=status element");
  const before = html.slice(0, m.index);
  const insideRow = before.lastIndexOf("<li") > before.lastIndexOf("</li>");
  return { text: m[1], insideRow };
}

describe("F1: the removal line stays when the list is read again without the app", () => {
  it("the status line exists before any removal, outside the rows, and is empty", async () => {
    const html = await section([example, second]);
    expect(statusOf(html)).toEqual({ text: "", insideRow: false });
  });

  it("after 204 and a list without the app: the line names the app", async () => {
    h.state = { phase: "removed", clientId: "app-1", name: "Example App" };
    const html = await section([second]);
    expect(statusOf(html)).toEqual({ text: "Access removed for Example App.", insideRow: false });
    expect(html).toContain("Second App");
  });

  it("after 204 and the last app: the line stays beside 'no applications'", async () => {
    h.state = { phase: "removed", clientId: "app-1", name: "Example App" };
    const html = await section([]);
    expect(statusOf(html).text).toBe("Access removed for Example App.");
    expect(html).toContain("You have not allowed any applications yet.");
  });

  it("before the list is read again, the removed app's row is already gone", async () => {
    h.state = { phase: "removed", clientId: "app-1", name: "Example App" };
    const html = await section([example, second]);
    expect(html).not.toContain("Can see: your email address");
    expect(html).toContain("Can see: your name");
  });

  it("404 not_found: the line says the app no longer has access", async () => {
    h.state = { phase: "gone", clientId: "app-1", name: "Example App" };
    const html = await section([second]);
    expect(statusOf(html)).toEqual({ text: "This app no longer has access.", insideRow: false });
  });

  it("a failure shows on its own row only, and the status line stays empty", async () => {
    h.state = {
      phase: "error",
      clientId: "app-1",
      name: "Example App",
      error: "Access could not be removed. Try again.",
    };
    const html = await section([example, second]);
    expect(statusOf(html).text).toBe("");
    const rows = html.split("<li").slice(1);
    expect(rows[0]).toContain("Access could not be removed. Try again.");
    expect(rows[1]).not.toContain("could not be removed");
  });

  it("the status line can take focus, so focus does not fall to the page", async () => {
    const html = await section([second]);
    expect(html).toMatch(
      /<p[^>]*role="status"[^>]*tabindex="-1"|<p[^>]*tabindex="-1"[^>]*role="status"/
    );
  });
});

describe("O3: the user page says when a new password is required", () => {
  it("the user client carries requires_password_change from OSS", async () => {
    idpFetch.mockResolvedValueOnce(
      json(200, {
        id: "01990000-0000-7000-8000-000000000031",
        email: "person@capture.test",
        role: "org_user",
        requires_password_change: true,
        created_at: "2026-10-01T10:00:00Z",
      })
    );
    const { getOrgUserById } = await import("../lib/idp-admin-client");
    const user = await getOrgUserById("01990000-0000-7000-8000-000000000031");
    expect(user?.requires_password_change).toBe(true);
  });

  it("an answer without the field (CE) reads as false", async () => {
    idpFetch.mockResolvedValueOnce(
      json(200, { id: "01990000-0000-7000-8000-000000000031", email: "p@capture.test" })
    );
    const { getOrgUserById } = await import("../lib/idp-admin-client");
    const user = await getOrgUserById("01990000-0000-7000-8000-000000000031");
    expect(user?.requires_password_change).toBe(false);
  });

  it("the page shows the line only when the flag is true", async () => {
    const { PasswordChangeRow } = await import("../app/org-admin/users/[id]/password-change-row");
    const on = renderToStaticMarkup(<PasswordChangeRow required={true} />);
    expect(on).toContain("Must choose a new password at next sign-in.");
    expect(renderToStaticMarkup(<PasswordChangeRow required={false} />)).toBe("");
  });
});

describe("F2: a 409 from organization create carries its code", () => {
  it("the client reads the code from the 409 body", async () => {
    idpFetch.mockResolvedValueOnce(json(409, { error: "slug_exists" }));
    const { createOrganization } = await import("../lib/idp-admin-client");
    const out = await createOrganization({ name: "Acme", domain: "acme.example" });
    expect(out).toEqual({ ok: false, status: 409, conflict: true, code: "slug_exists" });
  });

  it("a 409 without a JSON body still reads as a conflict, with no code", async () => {
    idpFetch.mockResolvedValueOnce(new Response("conflict", { status: 409 }));
    const { createOrganization } = await import("../lib/idp-admin-client");
    const out = await createOrganization({ name: "Acme", domain: "acme.example" });
    expect(out).toEqual({ ok: false, status: 409, conflict: true });
  });

  it("the form keeps today's domain words for a code it does not know", async () => {
    vi.doMock("@/lib/idp-admin-client", () => ({ createOrganization: h.createOrganization }));
    h.createOrganization.mockResolvedValueOnce({
      ok: false,
      status: 409,
      conflict: true,
      code: "something_new",
    });
    const { orgCreateConflict } = await import(
      "../app/site-admin/organizations/new/conflict-words"
    );
    const { createOrgAction } = await import("../app/site-admin/organizations/new/actions");
    expect(orgCreateConflict(undefined)).toEqual({
      field: "domain",
      text: "An organization with this domain already exists.",
    });
    const f = new FormData();
    f.set("name", "Acme duplicate");
    f.set("domain", "acme.example");
    const out = await createOrgAction({}, f);
    expect(out.fieldErrors?.domain).toBe("An organization with this domain already exists.");
  });
});
