/**
 * UI-0912-A, parts A2 and A3 (OSS v0.9.12 C4 and C6): the member area.
 *
 * - The member Overview showed four "Coming soon" cards. It now shows three
 *   working cards — Profile, Security, Sessions — each one link, each with
 *   real facts or a plain line when they cannot be read. Applications is not
 *   shown (owner Q4 b).
 * - The member menu has Overview, Profile, Security and Sessions in BOTH
 *   layouts that show it (owner Q5 a), through one shared component.
 * - A visitor who presented no credential at all is sent to the plain
 *   sign-in page; "Your session has expired" is kept for a credential that
 *   was presented and refused (UI019; RQ-4 a).
 * - Copy: the password tab says what a change really does; the MFA tab
 *   carries the owner's recovery-code sentence (Q6 a); the application forms
 *   no longer say secret rotation is missing.
 *
 * SECURITY: every value here is a fixture; no session id is ever rendered.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  profile: null as unknown,
  mfa: null as unknown,
  sessions: null as unknown,
  pathname: "/dashboard",
  search: "",
}));

vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_user", user: { role: "org_user" } }),
}));
vi.mock("@/lib/idp-admin-client", () => ({ getOwnProfile: async () => h.profile }));
vi.mock("@/lib/idp-account-client", () => ({
  getOwnMfaStatus: async () => h.mfa,
  listOwnSessions: async () => h.sessions,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.search),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const PROFILE = {
  email: "member@acme.test",
  name: "Mira Member",
  role: "org_user",
  organization_name: "Acme",
  domain: "acme.test",
  mfa_enabled: true,
  email_verified: true,
};
const SESSION_ID = "sid-fixture-must-not-render";
const session = (current: boolean) => ({
  id: SESSION_ID,
  created_at: "2026-10-12T10:00:00Z",
  expires_at: "2026-10-13T10:00:00Z",
  last_used_at: null,
  ip_address: null,
  user_agent: null,
  is_active: true,
  is_current: current,
});
const mfaOn = (n: number) => ({
  ok: true,
  status: { mfa_enabled: true, totp_enrolled: true, recovery_codes_remaining_count: n },
});

beforeEach(() => {
  h.profile = PROFILE;
  h.mfa = mfaOn(8);
  h.sessions = { ok: true, sessions: [session(true)] };
  h.pathname = "/dashboard";
  h.search = "";
});

async function overview(): Promise<string> {
  const { default: DashboardPage } = await import("../app/dashboard/page");
  return renderToStaticMarkup(await DashboardPage());
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("member Overview", () => {
  it("has no 'Coming soon', no Applications card, and three links to the right tabs", async () => {
    const html = await overview();
    expect(html).not.toContain("Coming soon");
    expect(text(html)).not.toContain("Applications");
    expect(html).toContain('href="/account/settings?tab=profile"');
    expect(html).toContain('href="/account/settings?tab=password"');
    expect(html).toContain('href="/account/settings?tab=sessions"');
    for (const link of ["Edit profile", "Manage security", "See devices and sign out"]) {
      expect(text(html)).toContain(link);
    }
  });

  it("the Profile card shows the name and email, or says the name is not set", async () => {
    let t = text(await overview());
    expect(t).toContain("Name: Mira Member");
    expect(t).toContain("Email: member@acme.test");
    expect(t).toContain(
      "Your name and the details apps can ask for. Apps see only what you agree to share."
    );
    h.profile = { ...PROFILE, name: null };
    t = text(await overview());
    expect(t).toContain("Name: not set");
  });

  it("the Security card: on with codes, few codes, none left, off, and not readable", async () => {
    let t = text(await overview());
    expect(t).toContain("Two-step sign-in: On");
    expect(t).toContain("Backup codes left: 8");
    expect(t).not.toContain("Make new ones.");
    h.mfa = mfaOn(2);
    t = text(await overview());
    expect(t).toContain("Only 2 backup codes left. Make new ones.");
    h.mfa = mfaOn(0);
    t = text(await overview());
    expect(t).toContain("No backup codes left. Make new ones.");
    h.mfa = {
      ok: true,
      status: { mfa_enabled: false, totp_enrolled: false, recovery_codes_remaining_count: 0 },
    };
    t = text(await overview());
    expect(t).toContain("Two-step sign-in: Off");
    expect(t).toContain("Add a second sign-in step to protect your account.");
    expect(t).not.toContain("Backup codes left");
    h.mfa = { ok: false, statusCode: 404, unavailable: true, unauthorized: false };
    t = text(await overview());
    expect(t).toContain("Manage your password and two-step sign-in.");
    expect(t).not.toContain("Two-step sign-in: O");
  });

  it("the Sessions card counts devices and never renders a session id", async () => {
    let html = await overview();
    expect(text(html)).toContain("Signed in on this device only.");
    expect(html).not.toContain(SESSION_ID);
    h.sessions = { ok: true, sessions: [session(true), session(false), session(false)] };
    html = await overview();
    expect(text(html)).toContain("Signed in on 3 devices.");
    expect(html).not.toContain(SESSION_ID);
    h.sessions = { ok: true, sessions: [] };
    expect(text(await overview())).toContain("No active sign-ins found.");
  });

  it("a card whose facts cannot be read says so and still links to its page", async () => {
    h.profile = null;
    h.mfa = { ok: false, statusCode: 0, unavailable: false, unauthorized: false };
    h.sessions = { ok: false, status: 500, unavailable: false };
    const html = await overview();
    const line = "We could not load this right now. Open the page to see it.";
    expect(text(html).split(line)).toHaveLength(4);
    expect(html).toContain('href="/account/settings?tab=profile"');
    expect(html).toContain('href="/account/settings?tab=password"');
    expect(html).toContain('href="/account/settings?tab=sessions"');
  });
});

describe("member menu", () => {
  async function nav(pathname: string, search = ""): Promise<string> {
    h.pathname = pathname;
    h.search = search;
    const { MemberNav } = await import("../components/shared/member-nav");
    return renderToStaticMarkup(<MemberNav />);
  }

  it("has Overview, Profile, Security and Sessions with their pages", async () => {
    const html = await nav("/dashboard");
    expect(text(html)).toContain("Overview Profile Security Sessions");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/account/settings?tab=profile"');
    expect(html).toContain('href="/account/settings?tab=password"');
    expect(html).toContain('href="/account/settings?tab=sessions"');
  });

  it.each([
    ["/dashboard", "", "Overview"],
    ["/account/settings", "tab=profile", "Profile"],
    ["/account/settings", "", "Security"],
    ["/account/settings", "tab=password", "Security"],
    ["/account/settings", "tab=mfa", "Security"],
    ["/account/settings", "tab=sessions", "Sessions"],
  ])("%s?%s marks %s as the current page, and only it", async (pathname, search, label) => {
    const html = await nav(pathname, search);
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(text(current[0] ?? "")).toContain(label);
  });

  it("both member layouts use the one shared menu", () => {
    for (const file of ["src/app/dashboard/layout.tsx", "src/app/account/layout.tsx"]) {
      expect(readFileSync(resolve(file), "utf8")).toContain("<MemberNav />");
    }
  });
});

describe("copy", () => {
  const read = (p: string) => readFileSync(resolve(p), "utf8").replace(/\s+/g, " ");

  it("the password tab says this device stays signed in and the others do not", () => {
    const page = read("src/app/account/settings/page.tsx");
    expect(page).toContain(
      "Change your password. You stay signed in here. Your other devices are signed out, and apps you connected will ask you to sign in again."
    );
    expect(page).not.toContain("All active sessions are revoked on save");
  });

  it("the MFA tab carries the owner's recovery-code sentence and keeps the rest", () => {
    const forms = read("src/app/account/settings/mfa-self-service-forms.tsx");
    expect(forms).toContain(
      "Recovery codes are for getting back in when your authenticator is lost. To make new recovery codes you must show you still have the authenticator."
    );
    expect(forms).toContain("A recovery code cannot be used to generate new recovery codes.");
  });

  it("no page under src/app says secret rotation is not available", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && /secret rotation is not yet available/.test(read(p)))
          hits.push(p);
      }
    };
    walk(resolve("src/app"));
    expect(hits).toEqual([]);
    expect(read("src/app/org-admin/applications/[id]/edit/edit-application-form.tsx")).toContain(
      "Client ID and Type cannot be changed from this form. To switch between Public and Confidential, create a replacement application."
    );
    expect(read("src/app/org-admin/applications/new/create-application-form.tsx")).toContain(
      "Copy this secret now. It will not be shown again. If you lose it, open the application and use Rotate client secret."
    );
  });
});
