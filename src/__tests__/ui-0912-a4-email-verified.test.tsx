/**
 * UI-0912-A4 (OSS v0.9.12 C2): the console says how an email address was
 * verified.
 *
 * - identuum-idp-oss now separates ACTIVATION (`email_verified`, the account
 *   may sign in) from a PROVEN MAILBOX (`email_proven`, with
 *   `email_verified_via` saying how). The member Overview shows the proven
 *   state, and a member whose mailbox is not proven can ask for a
 *   verification email (POST /api/v1/me/email/verification).
 * - Owner rule 2026-10-12 18:05: a user created while the server cannot
 *   send email stays "Not verified yet"; the page says plainly that this
 *   server cannot send email, and offers no button.
 * - The org_admin user detail says how the address was checked.
 * - identuum-idp-ce answers without the two fields: today's display stays.
 *
 * SECURITY: every value here is a fixture; nothing secret is rendered.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  profile: null as unknown,
  mailCeremonies: true,
  role: "org_user",
  sendResult: { outcome: "sent" } as unknown,
  sendCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true }, ag: { enabled: false } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: h.role, user: { role: h.role } }),
}));
vi.mock("@/lib/mail-capabilities", async (orig) => ({
  ...(await orig<object>()),
  mailCeremoniesAvailable: async () => h.mailCeremonies,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const ADDRESS = "member@acme.test";
const PROFILE = {
  email: ADDRESS,
  name: "Mira Member",
  role: "org_user",
  organization_name: "Acme",
  domain: "acme.test",
  mfa_enabled: true,
  email_verified: true,
};

beforeEach(() => {
  h.profile = PROFILE;
  h.mailCeremonies = true;
  h.role = "org_user";
  h.sendCalls = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/idp-admin-client");
  vi.doUnmock("@/lib/idp-account-client");
  vi.resetModules();
});

// ── the two label maps ──────────────────────────────────────────────────────

describe("memberEmailStatus — what the member sees (A-11..A-12)", () => {
  it.each([
    ["email_link", true, "Verified by email"],
    ["upstream_idp", true, "Verified by your sign-in provider"],
    ["legacy", true, "Verified"],
    [null, false, "Not verified yet"],
    ["admin_set", false, "Not verified yet"],
    ["admin_link", false, "Not verified yet"],
    ["setup", false, "Not verified yet"],
  ])("via %s, proven %s -> %s", async (via, proven, label) => {
    const { memberEmailStatus } = await import("@/lib/email-verification");
    expect(
      memberEmailStatus({ email_verified: true, email_verified_via: via, email_proven: proven })
    ).toEqual({ label, proven });
  });

  it("a server without the fields (identuum-idp-ce) gets no C2 status", async () => {
    const { memberEmailStatus } = await import("@/lib/email-verification");
    expect(memberEmailStatus({ email_verified: true })).toBeNull();
  });
});

describe("adminEmailStatus — what the org_admin sees (A-61..A-66)", () => {
  it.each([
    ["email_link", true, "Verified by email"],
    ["upstream_idp", true, "Verified by the sign-in provider"],
    ["legacy", true, "Verified (before v0.9.12)"],
    ["admin_set", false, "Not verified. Set by an administrator."],
    ["admin_link", false, "Not verified. Activated with a link from an administrator."],
    ["setup", false, "Not verified. Set during setup."],
    [null, false, "Not verified."],
  ])("via %s -> %s", async (via, proven, label) => {
    const { adminEmailStatus } = await import("@/lib/email-verification");
    expect(
      adminEmailStatus({ email_verified: true, email_verified_via: via, email_proven: proven })
    ).toBe(label);
  });

  it("a server without the fields gets no C2 status", async () => {
    const { adminEmailStatus } = await import("@/lib/email-verification");
    expect(adminEmailStatus({ email_verified: false })).toBeNull();
  });
});

describe("sendVerificationMessage — each answer has one plain line (A-13..A-17)", () => {
  it.each([
    ["sent", `Email sent to ${ADDRESS}. Open the link in it to finish.`],
    ["already_verified", "This address is already verified."],
    [
      "not_configured",
      "Not verified yet. This server cannot send email, so ask your administrator.",
    ],
    ["rate_limited", "Too many requests. Try again in a few minutes."],
    ["failed", "The email could not be sent. Nothing changed. Try again later."],
    ["not_for_account", "Email verification is not available for this account."],
  ])("%s", async (outcome, text) => {
    const { sendVerificationMessage } = await import("@/lib/email-verification");
    expect(sendVerificationMessage(outcome as never, ADDRESS)).toBe(text);
  });
});

// ── the IdP call: POST /api/v1/me/email/verification ────────────────────────

describe("sendOwnVerificationEmail reads every answer of the route", () => {
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it.each([
    [200, { status: "sent" }, "sent"],
    [200, { status: "already_verified" }, "already_verified"],
    [503, { error: "email_delivery_not_configured" }, "not_configured"],
    [502, { error: "email_delivery_failed" }, "failed"],
    [429, { error: "rate_limited" }, "rate_limited"],
    [409, { error: "not available for this account" }, "not_for_account"],
    [422, { error: "not available for this account" }, "not_for_account"],
    [401, { error: "unauthorized" }, "unauthorized"],
    [404, { error: "not found" }, "failed"],
    [503, { error: "service_unavailable" }, "failed"],
    [500, { error: "internal_error" }, "failed"],
  ])("HTTP %s %j -> %s", async (status, body, outcome) => {
    const fetchMock = reply(status, body);
    vi.stubGlobal("fetch", fetchMock);
    const { sendOwnVerificationEmail } = await import("@/lib/idp-account-client");
    await expect(sendOwnVerificationEmail()).resolves.toEqual({ outcome });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fixture.invalid/api/v1/me/email/verification");
    expect(init.method).toBe("POST");
    expect(init.body, "no body: the principal names the user").toBeUndefined();
  });

  it("a network failure is a failed send, not a verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network fixture")));
    const { sendOwnVerificationEmail } = await import("@/lib/idp-account-client");
    await expect(sendOwnVerificationEmail()).resolves.toEqual({ outcome: "failed" });
  });
});

describe("sendVerificationEmailAction", () => {
  beforeEach(() => {
    vi.doMock("@/lib/idp-account-client", () => ({
      sendOwnVerificationEmail: async () => {
        h.sendCalls++;
        return h.sendResult;
      },
    }));
  });

  it.each([
    "sent",
    "already_verified",
    "not_configured",
    "failed",
    "rate_limited",
    "not_for_account",
  ])("passes %s through", async (outcome) => {
    h.sendResult = { outcome };
    const { sendVerificationEmailAction } = await import("@/app/dashboard/email-actions");
    await expect(sendVerificationEmailAction({}, new FormData())).resolves.toEqual({ outcome });
  });

  it("a lost session goes to the sign-in page", async () => {
    h.sendResult = { outcome: "unauthorized" };
    const { sendVerificationEmailAction } = await import("@/app/dashboard/email-actions");
    await expect(sendVerificationEmailAction({}, new FormData())).rejects.toThrow(
      "redirect:/login?reason=session_expired"
    );
  });

  it("the site_admin is never sent to the IdP", async () => {
    h.role = "site_admin";
    const { sendVerificationEmailAction } = await import("@/app/dashboard/email-actions");
    await expect(sendVerificationEmailAction({}, new FormData())).resolves.toEqual({
      outcome: "not_for_account",
    });
    expect(h.sendCalls).toBe(0);
  });
});

// ── the member Overview ─────────────────────────────────────────────────────

async function renderOverview(): Promise<string> {
  vi.doMock("@/lib/idp-admin-client", () => ({ getOwnProfile: async () => h.profile }));
  vi.doMock("@/lib/idp-account-client", () => ({
    getOwnMfaStatus: async () => ({ ok: false, unavailable: true }),
    listOwnSessions: async () => ({ ok: true, sessions: [] }),
    listOwnConsents: async () => ({ ok: true, consents: [], accessTokenLifetimeSeconds: 3600 }),
    sendOwnVerificationEmail: async () => ({ outcome: "sent" }),
  }));
  const Page = (await import("@/app/dashboard/page")).default;
  return renderToStaticMarkup(await Page());
}

describe("member Overview email row", () => {
  it.each([
    ["email_link", "Verified by email"],
    ["upstream_idp", "Verified by your sign-in provider"],
  ])("proven via %s: %s, no button", async (via, label) => {
    h.profile = { ...PROFILE, email_verified_via: via, email_proven: true };
    const html = await renderOverview();
    expect(html).toContain("Email address");
    expect(html).toContain(label);
    expect(html).not.toContain("Send verification email");
    expect(html).not.toContain("Email verified");
  });

  it("pre-upgrade (legacy): plain Verified, never the admin wording", async () => {
    h.profile = { ...PROFILE, email_verified_via: "legacy", email_proven: true };
    const html = await renderOverview();
    expect(html).toContain(">Verified<");
    expect(html).not.toContain("before v0.9.12");
    expect(html).not.toContain("Send verification email");
  });

  it("not proven: Not verified yet, the button and the line under it", async () => {
    h.profile = { ...PROFILE, email_verified_via: "admin_link", email_proven: false };
    const html = await renderOverview();
    expect(html).toContain("Not verified yet");
    expect(html).toContain("Send verification email");
    expect(html).toContain(
      `We will send a link to ${ADDRESS}. Open it to confirm this mailbox is yours.`
    );
    expect(html).not.toContain("Unverified");
  });

  it("not proven on a server without email: the plain sentence, no button", async () => {
    h.mailCeremonies = false;
    h.profile = { ...PROFILE, email_verified: true, email_verified_via: null, email_proven: false };
    const html = await renderOverview();
    expect(html).toContain(
      "Not verified yet. This server cannot send email, so ask your administrator."
    );
    expect(html).not.toContain("Send verification email");
  });

  it("the site_admin is never offered the button", async () => {
    h.role = "site_admin";
    h.profile = {
      ...PROFILE,
      role: "site_admin",
      email_verified_via: "setup",
      email_proven: false,
    };
    const html = await renderOverview();
    expect(html).toContain("Not verified yet");
    expect(html).not.toContain("Send verification email");
    expect(html).not.toContain("This server cannot send email");
  });

  it("identuum-idp-ce (no fields): today's Verified / Unverified row", async () => {
    h.profile = { ...PROFILE, email_verified: false };
    let html = await renderOverview();
    expect(html).toContain("Email verified");
    expect(html).toContain("Unverified");
    expect(html).not.toContain("Send verification email");
    vi.resetModules();
    h.profile = { ...PROFILE, email_verified: true };
    html = await renderOverview();
    expect(html).toContain("Email verified");
    expect(html).not.toContain("Not verified yet");
  });
});

describe("getOwnProfile maps the two fields; absent stays absent", () => {
  it.each([
    [{ email_verified_via: "email_link", email_proven: true }, "email_link", true],
    [{ email_verified_via: null, email_proven: false }, null, false],
    [{}, undefined, undefined],
  ])("%j", async (extra, via, proven) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...PROFILE, ...extra }), { status: 200 }))
    );
    const { getOwnProfile } = await import("@/lib/idp-admin-client");
    const p = await getOwnProfile();
    expect(p?.email_verified_via).toBe(via);
    expect(p?.email_proven).toBe(proven);
  });
});

// ── the org_admin user detail ───────────────────────────────────────────────

const USER_ID = "01990000-0000-7000-8000-0000000000aa";
const USER = {
  id: USER_ID,
  email: "someone@acme.test",
  name: "Some One",
  role: "org_user",
  banned: false,
  deleted: false,
  mfa_enabled: false,
  email_verified: true,
  invitation_pending: false,
  created_at: "2026-09-29T10:00:00Z",
};

async function renderDetail(user: Record<string, unknown>): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith(`/api/v1/users/${USER_ID}`)) {
        return new Response(JSON.stringify(user), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    })
  );
  const Page = (await import("@/app/org-admin/users/[id]/page")).default;
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: USER_ID }) }));
}

describe("org_admin user detail email status", () => {
  it.each([
    ["email_link", true, "Verified by email"],
    ["upstream_idp", true, "Verified by the sign-in provider"],
    ["legacy", true, "Verified (before v0.9.12)"],
    ["admin_set", false, "Not verified. Set by an administrator."],
    ["admin_link", false, "Not verified. Activated with a link from an administrator."],
    ["setup", false, "Not verified. Set during setup."],
    [null, false, "Not verified."],
  ])("via %s -> %s", async (via, proven, label) => {
    const html = await renderDetail({ ...USER, email_verified_via: via, email_proven: proven });
    expect(html).toContain(label);
    expect(html, "the activation Yes/No row is replaced").not.toContain("Email verified");
  });

  it("identuum-idp-ce (no fields): today's Email verified Yes/No row", async () => {
    const html = await renderDetail(USER);
    expect(html).toContain("Email verified");
    expect(html).not.toContain("Not verified.");
  });
});
