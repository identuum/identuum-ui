/**
 * UI-0913-C-FOLLOWUP (after OSS-0913-C, identuum-idp-oss d6072cf): the audit
 * filter reads its event list from GET /api/v1/audit/event-types (route 166,
 * served by OSS too) and keeps a plain-words line when that read fails; a
 * duplicate on organization create names its field; an admin reset link
 * whose other sign-ins could not be ended still reads as "password set",
 * with a warning and no retry.
 * Every body below is the exact OSS answer (reports/OSS-0913-C-STAGE.txt
 * ITEMS 2, 3, 3b). SECURITY: every value is a fixture; no token, link or
 * cookie appears.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: {} as unknown }));

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
  h.state = {};
  vi.unstubAllGlobals();
  vi.resetModules();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ── 1. the audit filter's event list ────────────────────────────────────────

const eventTypesBody = {
  groups: [
    {
      label: "Sign-in",
      types: [{ value: "auth.oidc_login.failure", label: "Auth OIDC login failure" }],
    },
    {
      label: "Tokens and consent",
      types: [{ value: "consent.granted", label: "Consent granted" }],
    },
  ],
};

const noFilters = {
  eventType: null,
  subjectType: null,
  window: null,
  startDate: null,
  endDate: null,
  sortOrder: "desc" as const,
};

describe("the audit filter's event list (route 166)", () => {
  it("reads the groups from GET /api/v1/audit/event-types", async () => {
    idpFetch.mockResolvedValueOnce(json(200, eventTypesBody));
    const { listAuditEventTypes } = await import("../lib/idp-admin-client");
    expect(await listAuditEventTypes()).toEqual(eventTypesBody.groups);
    expect(idpFetch.mock.calls[0][0]).toBe("http://idp.test/api/v1/audit/event-types");
  });

  it("offers the server's groups and labels", async () => {
    const { AuditFilterPanel } = await import("../components/shared/audit-filter-panel");
    const html = renderToStaticMarkup(
      <AuditFilterPanel
        basePath="/site-admin/audit"
        filters={noFilters}
        eventTypeGroups={eventTypesBody.groups}
      />
    );
    expect(html).toContain('<optgroup label="Sign-in">');
    expect(html).toContain(
      '<option value="auth.oidc_login.failure">Auth OIDC login failure</option>'
    );
    expect(html).not.toContain("could not be loaded");
  });

  it("when the route fails it says so in plain words and keeps no list of its own", async () => {
    const { AuditFilterPanel } = await import("../components/shared/audit-filter-panel");
    const html = renderToStaticMarkup(
      <AuditFilterPanel basePath="/site-admin/audit" filters={noFilters} eventTypeGroups={null} />
    );
    expect(html).not.toContain("<optgroup");
    expect(html).toMatch(/<option value=""[^>]*>All events<\/option>/);
    expect(html).toContain(
      "The list of event types could not be loaded. You can still filter by the other fields."
    );
  });

  it("when the route fails a filter already in the address stays selectable", async () => {
    const { AuditFilterPanel } = await import("../components/shared/audit-filter-panel");
    const html = renderToStaticMarkup(
      <AuditFilterPanel
        basePath="/site-admin/audit"
        filters={{ ...noFilters, eventType: "consent.granted" }}
        eventTypeGroups={null}
      />
    );
    expect(html).toMatch(/<option value="consent.granted"[^>]*>consent.granted<\/option>/);
  });

  it("the static compile-time list is gone", async () => {
    const lib: Record<string, unknown> = await import("../lib/audit-event-types");
    expect(lib.AUDIT_EVENT_TYPE_GROUPS).toBeUndefined();
    expect(lib.KNOWN_AUDIT_EVENT_TYPES).toBeUndefined();
  });
});

// ── 2. a duplicate on organization create names its field ───────────────────

const conflicts = [
  {
    body: {
      error: "domain_exists",
      message: "An organization with this domain already exists.",
    },
    field: "domain",
    text: "An organization with this domain already exists.",
  },
  {
    body: { error: "slug_exists", message: "An organization with this name already exists." },
    field: "name",
    text: "An organization with this name already exists. Choose another name.",
  },
  {
    body: { error: "email_exists", message: "This email address already has an account." },
    field: "admin_email",
    text: "This email address already has an account. Use another address.",
  },
] as const;

function orgForm(): FormData {
  const f = new FormData();
  f.set("name", "Acme");
  f.set("domain", "acme.example");
  f.set("admin_email", "admin@acme.example");
  return f;
}

describe("organization create: 409 names the field", () => {
  it.each(conflicts)("409 $body.error -> the $field field", async ({ body, field, text }) => {
    idpFetch.mockResolvedValueOnce(json(409, body));
    const { createOrgAction } = await import("../app/site-admin/organizations/new/actions");
    const out = await createOrgAction({}, orgForm());
    expect(out.fieldErrors).toEqual({ [field]: text });
    expect(out.error).toBeUndefined();
  });

  it.each(conflicts)(
    "the form shows the $body.error words under its field",
    async ({ field, text }) => {
      h.state = { fieldErrors: { [field]: text } };
      const { CreateOrgForm } = await import("../app/site-admin/organizations/new/form-client");
      const html = renderToStaticMarkup(<CreateOrgForm />);
      expect(html).toContain(text);
    }
  );
});

// ── 3. the reset link: password set, other sign-ins not ended ───────────────

const sessionsNotEnded = {
  error: "sessions_not_ended",
  message:
    "Your new password is set, but your other sign-ins could not be ended. Sign in with the new password and ask your administrator to end your other sessions.",
};

const WARNING =
  "Your other sign-ins could not be ended. Ask your administrator to end your other sessions.";

function resetForm(): FormData {
  const d = new FormData();
  d.set("token", "t".repeat(64));
  d.set("new_password", "A long enough password 1!");
  d.set("confirm_password", "A long enough password 1!");
  return d;
}

describe("reset link redeem: 500 sessions_not_ended", () => {
  it("reads as password set, with a warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(500, sessionsNotEnded))
    );
    const { redeemResetLinkAction } = await import("../app/reset-link/actions");
    const out = await redeemResetLinkAction({ phase: "form" }, resetForm());
    expect(out).toEqual({ phase: "success", warning: WARNING });
  });

  it("another 500 still asks to try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(500, { error: "internal_error" }))
    );
    const { redeemResetLinkAction } = await import("../app/reset-link/actions");
    const out = await redeemResetLinkAction({ phase: "form" }, resetForm());
    expect(out.phase).toBe("form");
  });

  it("the result page says the password is set, shows the warning, and offers no retry", async () => {
    h.state = { phase: "success", warning: WARNING };
    const { ResetLinkFormClient } = await import("../app/reset-link/form-client");
    const html = renderToStaticMarkup(<ResetLinkFormClient rawToken={"t".repeat(64)} />);
    expect(html).toContain("Your password was changed.");
    expect(html).toContain(WARNING);
    expect(html).not.toContain("You were signed out everywhere");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="/login"');
  });

  it("a plain success keeps its signed-out-everywhere line", async () => {
    h.state = { phase: "success" };
    const { ResetLinkFormClient } = await import("../app/reset-link/form-client");
    const html = renderToStaticMarkup(<ResetLinkFormClient rawToken={"t".repeat(64)} />);
    expect(html).toContain("You were signed out everywhere");
    expect(html).not.toContain("could not be ended");
  });
});
