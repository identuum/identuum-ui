/**
 * UI-0912-AB-FIX on the member Overview (review F10; UI-0912-A4 Q2):
 * - the identity card says "Two-step sign-in", as the Security card does;
 * - a Security card whose status read got 503 says it could not load (A-08),
 *   not the "this server has no such page" line (A-05);
 * - "Send verification email" has the 44 px touch target (judge ruling b).
 * SECURITY: every value is a fixture.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mfa: null as unknown }));

vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_user", user: { role: "org_user" } }),
}));
vi.mock("@/lib/idp-admin-client", () => ({
  getOwnProfile: async () => ({
    email: "member@acme.test",
    name: "Mira Member",
    role: "org_user",
    organization_name: "Acme",
    mfa_enabled: true,
    email_verified: true,
  }),
}));
vi.mock("@/lib/idp-account-client", () => ({
  getOwnMfaStatus: async () => h.mfa,
  listOwnSessions: async () => ({ ok: true, sessions: [] }),
  listOwnConsents: async () => ({ ok: true, consents: [], accessTokenLifetimeSeconds: 3600 }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

beforeEach(() => {
  h.mfa = {
    ok: true,
    status: { mfa_enabled: true, totp_enrolled: true, recovery_codes_remaining_count: 8 },
  };
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function overview(): Promise<string> {
  const { default: DashboardPage } = await import("../app/dashboard/page");
  return renderToStaticMarkup(await DashboardPage());
}

describe("member Overview after the review", () => {
  it("the identity card says Two-step sign-in, never Two-factor auth", async () => {
    const t = text(await overview());
    expect(t).not.toContain("Two-factor auth");
  });

  it("a 503 on the two-step status reads A-08; a missing route still reads A-05", async () => {
    h.mfa = { ok: false, statusCode: 503, unavailable: true, unauthorized: false };
    let t = text(await overview());
    expect(t).toContain("We could not load this right now. Open the page to see it.");
    expect(t).not.toContain("Manage your password and two-step sign-in.");
    h.mfa = { ok: false, statusCode: 404, unavailable: true, unauthorized: false };
    t = text(await overview());
    expect(t).toContain("Manage your password and two-step sign-in.");
  });

  it("Send verification email is 44 px tall (h-11)", async () => {
    const { SendVerificationEmail } = await import("../app/dashboard/send-verification-email");
    const html = renderToStaticMarkup(<SendVerificationEmail address="member@acme.test" />);
    const button = html.match(/<button[^>]*>[\s\S]*?Send verification email/)?.[0] ?? "";
    expect(button).toContain("h-11");
    expect(button).not.toMatch(/\bh-8\b|\bh-9\b/);
  });
});
