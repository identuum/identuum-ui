/**
 * CE-UI-2b (owner decision 2026-09-26, wiki platform/ce-mail-ceremonies.md
 * option B). The mail ceremonies — forgot password, reset password, email
 * verification and the activation mail — are offered only where the IdP can
 * send mail: GET /api/v1/component `capabilities.mail_ceremonies` (false on
 * identuum-idp-ce; true on identuum-idp-oss only when SMTP is configured).
 * Where it is false the sign-in form says "Ask your administrator to reset
 * your password." and the four pages say "not available on this
 * installation" and call nothing. Where `admin_reset_link` is true
 * (identuum-idp-ce), an org_admin creates a one-time reset link on the user
 * detail page, and the user redeems it on /reset-link.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let capabilities: Record<string, boolean> = {};
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities }, ag: null },
  }),
}));
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

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  idpFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const noMail = { mail_ceremonies: false, admin_reset_link: true };
const withMail = { mail_ceremonies: true, admin_reset_link: false };
const token = { searchParams: Promise.resolve({ token: "t".repeat(64) }) };

describe("the sign-in form without mail ceremonies", () => {
  it("offers no Forgot password? link and names the administrator", async () => {
    const { PasswordForm } = await import("../components/auth/password-form");
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PasswordForm
        email="a@example.test"
        mailCeremonies={false}
        onMfaRequired={noop}
        onMfaEnrollmentRequired={noop}
        onSuccess={noop}
      />
    );
    expect(html).not.toContain("/forgot-password");
    expect(html).toContain("Ask your administrator to reset your password.");
  });
  it("keeps the link where mail can be sent", async () => {
    const { PasswordForm } = await import("../components/auth/password-form");
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PasswordForm
        email="a@example.test"
        mailCeremonies
        onMfaRequired={noop}
        onMfaEnrollmentRequired={noop}
        onSuccess={noop}
      />
    );
    expect(html).toContain('href="/forgot-password"');
  });
});

describe("the four mail pages without mail ceremonies", () => {
  const pages: Array<[string, () => Promise<unknown>]> = [
    ["forgot-password", async () => (await import("../app/forgot-password/page")).default()],
    ["reset-password", async () => (await import("../app/reset-password/page")).default(token)],
    ["verify-email", async () => (await import("../app/verify-email/page")).default(token)],
    ["activate", async () => (await import("../app/activate/page")).default(token)],
  ];
  for (const [name, render] of pages) {
    it(`${name} says it is not available on this installation and calls nothing`, async () => {
      capabilities = noMail;
      const html = renderToStaticMarkup((await render()) as React.ReactElement);
      expect(html).toContain("not available on this installation");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(idpFetch).not.toHaveBeenCalled();
    });
  }
  it("forgot-password still renders its form where mail can be sent", async () => {
    capabilities = withMail;
    const html = renderToStaticMarkup(
      (await (await import("../app/forgot-password/page")).default()) as React.ReactElement
    );
    expect(html).not.toContain("not available on this installation");
  });
});

describe("the forgot-password action never reports sent on a non-2xx", () => {
  function fd(email: string): FormData {
    const f = new FormData();
    f.set("email", email);
    return f;
  }
  for (const status of [404, 429, 500]) {
    it(`a ${status} is not "sent"`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status }))
      );
      const { requestPasswordResetAction } = await import("../app/forgot-password/actions");
      const state = await requestPasswordResetAction({ phase: "form" }, fd("a@example.test"));
      expect(state.phase).not.toBe("sent");
      expect(state.error).toBeTruthy();
    });
  }
});

describe("the org_admin's reset link on the user detail page", () => {
  const member = {
    role: "org_user" as const,
    email: "member@example.test",
    active: true,
    banned: false,
    pending_setup: false,
    mfa_enabled: true,
  };
  it("offers reset-link only where the IdP issues admin reset links", async () => {
    const { deriveOrgAdminUserActions } = await import(
      "../app/org-admin/users/[id]/user-detail-actions"
    );
    expect(
      deriveOrgAdminUserActions(member as never, 1, null, { adminResetLink: true }).actions
    ).toContain("reset-link");
    expect(
      deriveOrgAdminUserActions(member as never, 1, null, { adminResetLink: false }).actions
    ).not.toContain("reset-link");
    expect(
      deriveOrgAdminUserActions({ ...member, role: "site_admin" } as never, 1, null, {
        adminResetLink: true,
      }).actions
    ).toEqual([]);
  });
  it("mints through POST /api/v1/users/:id/recovery/reset-link and returns the link once", async () => {
    idpFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reset_url: "http://idp.test/reset-link?token=abc",
          expires_at: "2026-09-27T00:00:00Z",
        }),
        { status: 200 }
      )
    );
    const { createPasswordResetLink } = await import("../lib/idp-admin-client");
    const out = await createPasswordResetLink("0198b2d0-0000-7000-8000-0000000000bb");
    expect(idpFetch).toHaveBeenCalledWith(
      "http://idp.test/api/v1/users/0198b2d0-0000-7000-8000-0000000000bb/recovery/reset-link",
      expect.objectContaining({ method: "POST" })
    );
    expect(out).toEqual({
      ok: true,
      resetUrl: "http://idp.test/reset-link?token=abc",
      expiresAt: "2026-09-27T00:00:00Z",
    });
  });
});

describe("the /reset-link redeem page", () => {
  it("declares Referrer-Policy no-referrer (its URL carries the token)", async () => {
    const { metadata } = await import("../app/reset-link/page");
    expect(metadata.referrer).toBe("no-referrer");
  });
  it("posts {token,new_password} to /api/v1/auth/reset-link and maps the answers", async () => {
    const { redeemResetLinkAction } = await import("../app/reset-link/actions");
    const f = (pw: string) => {
      const d = new FormData();
      d.set("token", "t".repeat(64));
      d.set("new_password", pw);
      d.set("confirm_password", pw);
      return d;
    };
    const post = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal("fetch", post);
    expect(
      (await redeemResetLinkAction({ phase: "form" }, f("A long enough password 1!"))).phase
    ).toBe("success");
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://idp.test/api/v1/auth/reset-link");
    expect(JSON.parse(init.body as string)).toEqual({
      token: "t".repeat(64),
      new_password: "A long enough password 1!",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"weak_password"}', { status: 400 }))
    );
    const weak = await redeemResetLinkAction({ phase: "form" }, f("A long enough password 1!"));
    expect(weak.phase).toBe("form");
    expect(weak.error).toMatch(/password/i);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"invalid_token"}', { status: 400 }))
    );
    expect(
      (await redeemResetLinkAction({ phase: "form" }, f("A long enough password 1!"))).phase
    ).toBe("invalid");
  });
});
