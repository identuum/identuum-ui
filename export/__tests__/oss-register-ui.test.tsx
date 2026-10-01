import { afterEach, describe, expect, it, vi } from "vitest";
import { setOrgRegistrationAction } from "@/app/org-admin/settings/registration-actions";
import { SELF_REGISTRATION_COPY } from "@/app/org-admin/settings/self-registration-section";
import { rejectRegistrationAction } from "@/app/org-admin/users/actions";
import { registerAction } from "@/app/register/[slug]/actions";
import {
  REGISTER_CLOSED,
  registrationAcceptedMessage,
} from "@/app/register/[slug]/register-helpers";
import { setInstanceRegistrationAction } from "@/app/site-admin/settings/self-registration-actions";
import { isServerRoute } from "../src/server-routes";
import { installExport, OSS_COMPONENT, type Routes } from "./harness";
import {
  answers,
  ORG,
  page,
  SITE_ADMIN_SESSION,
  SITE_ORG,
  siteAnswers,
  sitePage,
} from "./recorded";

// OSS-REGISTER-UI (D-021): the self-registration console as the binary ships
// it — the instance switch (site_admin), the organization's policy and its
// pending sign-ups (org_admin), the public /register/<org_slug> page — and
// archived organizations offering no action but Restore.

afterEach(() => vi.unstubAllGlobals());

const SLUG = (answers["GET /api/v1/organizations/current"] as { json: { org_slug: string } }).json
  .org_slug;
const REG = `GET /api/v1/organizations/${ORG}/registration`;
const INFO = `GET /api/v1/auth/register/${SLUG}`;
const policy = (extra: Record<string, unknown> = {}) => ({
  json: {
    allow_public_registration: true,
    require_registration_approval: false,
    verify_email: false,
    email_domains: [],
    ...extra,
  },
});
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const section = (html: string) =>
  html.match(/data-testid="org-self-registration"[\s\S]*?<\/section>/)?.[0] ?? "";
const verifyInput = (s: string) => s.match(/<input[^>]*name="verify"[^>]*>/)?.[0] ?? "";

describe("item 2: the instance self-registration switch (site_admin settings)", () => {
  it("shows the switch with its one-line explanation", async () => {
    const { html } = await sitePage("/site-admin/settings", {
      "GET /api/v1/settings/self-registration": { json: { enabled: false } },
    });
    expect(html).toContain('data-testid="instance-self-registration"');
    expect(html).toContain("when off, no organization accepts sign-ups.");
    expect(html).toContain(">Off<");
    expect(html).toContain("Turn on");
  });

  it("an unreadable switch says so rather than showing Off", async () => {
    const { html } = await sitePage("/site-admin/settings", {
      "GET /api/v1/settings/self-registration": { status: 503, json: {} },
    });
    expect(html).toContain("The setting could not be read.");
    expect(html).not.toContain("Turn on");
  });

  it("Turn on PUTs {enabled:true} through the boundary", async () => {
    const env = installExport("/site-admin/settings", {
      ...siteAnswers,
      "GET /api/v1/validate": SITE_ADMIN_SESSION,
      "PUT /api/v1/settings/self-registration": { json: { enabled: true } },
    });
    const r = await setInstanceRegistrationAction({ enabled: false }, form({ enabled: "true" }));
    expect(r).toEqual({ enabled: true });
    const put = env.calls.find((c) => c.method === "PUT");
    expect(put).toMatchObject({ path: "/api/v1/settings/self-registration", viaBff: true });
    expect(put?.body).toEqual({ enabled: true });
  });
});

describe("item 3: the organization's self-registration (org_admin settings)", () => {
  it("an open organization shows its policy and the sign-up link with Copy", async () => {
    const { html } = await page("/org-admin/settings", {
      [REG]: policy({ email_domains: ["capture.test"] }),
      [INFO]: { json: { open: true } },
    });
    const s = section(html);
    expect(s).toContain("Self-registration");
    expect(s).toContain('value="capture.test"');
    expect(s).toContain(`http://idp.test/register/${SLUG}`);
    expect(s).toContain("Copy");
    expect(s).not.toContain(SELF_REGISTRATION_COPY.instanceOff);
  });

  it("without email delivery the verify switch is disabled, with the reason", async () => {
    const { html } = await page("/org-admin/settings", {
      "GET /api/v1/component": {
        json: {
          ...OSS_COMPONENT,
          capabilities: { ...OSS_COMPONENT.capabilities, mail_ceremonies: false },
        },
      },
      [REG]: policy(),
      [INFO]: { json: { open: true } },
    });
    const s = section(html);
    expect(verifyInput(s)).toContain('disabled=""');
    expect(s).toContain(SELF_REGISTRATION_COPY.noMail);
  });

  it("with email delivery the verify switch is enabled", async () => {
    const { html } = await page("/org-admin/settings", {
      "GET /api/v1/component": {
        json: {
          ...OSS_COMPONENT,
          capabilities: { ...OSS_COMPONENT.capabilities, mail_ceremonies: true },
        },
      },
      [REG]: policy(),
      [INFO]: { json: { open: true } },
    });
    const s = section(html);
    expect(verifyInput(s)).toContain('name="verify"');
    expect(verifyInput(s)).not.toContain('disabled=""');
    expect(s).not.toContain(SELF_REGISTRATION_COPY.noMail);
  });

  it("while the instance is off it is read-only with a note, and offers no link", async () => {
    // Open in the organization, closed in public: the instance switch holds it.
    const { html } = await page("/org-admin/settings", {
      [REG]: policy(),
      [INFO]: { json: { open: false } },
    });
    const s = section(html);
    expect(s).toContain(SELF_REGISTRATION_COPY.instanceOff);
    expect(s).toMatch(/<fieldset disabled=""/);
    expect(s).not.toContain(`/register/${SLUG}`);
  });

  it("a closed organization with the instance on is editable and shows no link", async () => {
    const { html } = await page("/org-admin/settings", {
      [REG]: policy({ allow_public_registration: false }),
      [INFO]: { json: { open: false } },
    });
    const s = section(html);
    expect(s).not.toContain(SELF_REGISTRATION_COPY.instanceOff);
    expect(s).not.toMatch(/<fieldset disabled=""/);
    expect(s).not.toContain(`/register/${SLUG}`);
  });

  it("an unreadable policy says so", async () => {
    const { html } = await page("/org-admin/settings", { [REG]: { status: 503, json: {} } });
    expect(section(html)).toContain("The setting could not be read.");
  });

  const current = policy().json;
  it("save PUTs the form's policy to the own organization through the boundary", async () => {
    const env = installExport("/org-admin/settings", {
      ...answers,
      [`PUT /api/v1/organizations/${ORG}/registration`]: (req) => ({ json: req.body }),
    });
    const r = await setOrgRegistrationAction(
      { settings: current },
      form({ org_id: ORG, allow: "on", approval: "on", domains: "A.test, b.test" })
    );
    expect(r.saved).toBe(true);
    const put = env.calls.find((c) => c.method === "PUT");
    expect(put).toMatchObject({ viaBff: true, proof: true });
    expect(put?.body).toEqual({
      allow_public_registration: true,
      require_registration_approval: true,
      verify_email: false,
      email_domains: ["a.test", "b.test"],
    });
  });

  it("400 smtp_not_configured is shown plainly", async () => {
    installExport("/org-admin/settings", {
      ...answers,
      [`PUT /api/v1/organizations/${ORG}/registration`]: {
        status: 400,
        json: { error: "smtp_not_configured" },
      },
    });
    const r = await setOrgRegistrationAction(
      { settings: current },
      form({ org_id: ORG, verify: "on" })
    );
    expect(r.error).toBe(
      "Email delivery is not configured on the identity provider, so email verification cannot be required."
    );
    expect(r.instanceOff).toBeFalsy();
  });

  it("409 instance_registration_disabled turns the form read-only", async () => {
    installExport("/org-admin/settings", {
      ...answers,
      [`PUT /api/v1/organizations/${ORG}/registration`]: {
        status: 409,
        json: { error: "instance_registration_disabled" },
      },
    });
    const r = await setOrgRegistrationAction(
      { settings: current },
      form({ org_id: ORG, allow: "on" })
    );
    expect(r.instanceOff).toBe(true);
    expect(r.settings).toEqual(current);
  });
});

describe("item 4: the public /register/<org_slug> page", () => {
  it("is a routed public page", () => {
    expect(isServerRoute("/register/acme")).toBe(true);
    expect(isServerRoute("/register")).toBe(false);
  });

  const render = async (answer: Routes[string]) => {
    const env = installExport("/register/acme", { "GET /api/v1/auth/register/acme": answer });
    return (await env.render()).html;
  };

  it("closed, unknown and unreachable all read the same", async () => {
    const closed = await render({ json: { open: false } });
    const unknown = await render({ status: 404, json: {} });
    const down = await render({ status: 503, json: {} });
    expect(closed).toContain(REGISTER_CLOSED);
    expect(closed).not.toContain('data-testid="register-form"');
    expect(unknown).toBe(closed);
    expect(down).toBe(closed);
  });

  it("an open organization shows email, name and password with its policy", async () => {
    const html = await render({
      json: {
        open: true,
        verify_email: true,
        approval_required: false,
        password_policy: { min_length: 12, complexity: true },
      },
    });
    expect(html).toContain('data-testid="register-form"');
    for (const n of ["email", "name", "password"]) expect(html).toContain(`name="${n}"`);
    expect(html).toMatch(/name="password"[^>]*minLength="12"|minLength="12"[^>]*name="password"/);
    expect(html).toContain(
      "At least 12 characters, with upper- and lower-case letters, a digit and a symbol."
    );
    expect(html).not.toContain(REGISTER_CLOSED);
  });

  it("a relaxed policy names only the length", async () => {
    const html = await render({
      json: { open: true, password_policy: { min_length: 8, complexity: false } },
    });
    expect(html).toContain("At least 8 characters.");
  });

  it("every accepted submission reads one neutral message per the settings", () => {
    const m = (verify_email: boolean, approval_required: boolean) =>
      registrationAcceptedMessage({ verify_email, approval_required });
    const all = [m(true, false), m(false, false), m(false, true), m(true, true)];
    expect(new Set(all).size).toBe(4);
    for (const s of all) expect(s.startsWith("If this address can be registered")).toBe(true);
    expect(m(true, false)).toContain("verify");
    expect(m(false, false)).toContain("Sign in");
    expect(m(false, true)).toContain("approved");
  });

  it("202 is accepted; the POST is the public route with the form's fields", async () => {
    const env = installExport("/register/acme", {
      "POST /api/v1/auth/register/acme": { status: 202, json: { accepted: true } },
    });
    const r = await registerAction(
      { phase: "form" },
      form({ slug: "acme", email: " new@capture.test ", name: "New", password: "pw-fixture" })
    );
    expect(r).toEqual({ phase: "accepted" });
    const post = env.calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/v1/auth/register/acme");
    expect(post?.body).toEqual({ email: "new@capture.test", name: "New", password: "pw-fixture" });
  });

  it("400 weak_password stays on the form with the policy's own sentence", async () => {
    installExport("/register/acme", {
      "POST /api/v1/auth/register/acme": {
        status: 400,
        json: {
          error: "weak_password",
          message: "password too short: minimum 12 characters required",
        },
      },
    });
    const r = await registerAction(
      { phase: "form" },
      form({ slug: "acme", email: "a@b.test", name: "A", password: "x" })
    );
    expect(r).toEqual({
      phase: "form",
      error: "password too short: minimum 12 characters required",
    });
  });
});

describe("item 5: pending registrations on the org_admin users page", () => {
  const PENDING_ID = "01990000-0000-7000-8000-0000000000e1";
  const pending = {
    [`GET /api/v1/organizations/${ORG}/registrations`]: {
      json: {
        registrations: [
          {
            id: PENDING_ID,
            email: "pending@capture.test",
            name: "Pending",
            created_at: "2026-10-01T00:00:00Z",
          },
        ],
      },
    },
  };

  it("lists each pending sign-up with Approve and a Reject that asks first", async () => {
    const { html } = await page("/org-admin/users", pending);
    const s = html.match(/data-testid="pending-registrations"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(s).toContain("pending@capture.test");
    expect(s).toContain(">Approve<");
    expect(s).toContain("Reject…");
    // Before the confirmation only the Approve form exists: Reject is one more step.
    expect(s.match(/<form/g)?.length).toBe(1);
    expect(s).not.toContain("Delete this sign-up?");
  });

  it("no pending sign-ups, no section", async () => {
    const { html } = await page("/org-admin/users", {
      [`GET /api/v1/organizations/${ORG}/registrations`]: { json: { registrations: [] } },
    });
    expect(html).not.toContain('data-testid="pending-registrations"');
  });

  it("Reject POSTs /users/:id/reject through the boundary", async () => {
    const env = installExport("/org-admin/users", {
      ...answers,
      [`POST /api/v1/users/${PENDING_ID}/reject`]: { status: 204 },
    });
    const r = await rejectRegistrationAction({ phase: "idle" }, form({ userId: PENDING_ID }));
    expect(r).toEqual({ phase: "success" });
    expect(env.calls.find((c) => c.method === "POST")).toMatchObject({
      path: `/api/v1/users/${PENDING_ID}/reject`,
      viaBff: true,
      proof: true,
    });
  });
});

describe("item 6: an archived organization offers no action but Restore", () => {
  const ORG_PATH = `/api/v1/organizations/${SITE_ORG}`;
  const recordedOrg = (siteAnswers[`GET ${ORG_PATH}`] as { json: Record<string, unknown> }).json;
  const archived = { deleted_at: "2026-10-01T00:00:00Z" };
  // OSS marks an archived organization with deleted_at and no deleted flag.
  const unclaimed = {
    ...recordedOrg,
    ...archived,
    active: true,
    is_claimed: false,
    can_assign_admin: false,
  };
  const pendingActivation = {
    ...recordedOrg,
    ...archived,
    active: false,
    is_claimed: true,
    can_assign_admin: true,
  };
  const admins = {
    json: {
      admins: [
        {
          id: "01990000-0000-7000-8000-0000000000f1",
          email: "admin@capture.test",
          active: true,
          deleted: false,
          email_verified: false,
          mfa_enabled: true,
        },
      ],
    },
  };
  const href = (route: string) => `href="/site-admin/organizations/${SITE_ORG}/${route}"`;

  const render = (org: Record<string, unknown>) =>
    sitePage(`/site-admin/organizations/${SITE_ORG}`, {
      [`GET ${ORG_PATH}`]: { json: org },
      [`GET ${ORG_PATH}/admin-recovery-candidates`]: admins,
    });

  it.each([
    ["edit", unclaimed, href("edit")],
    ["deactivate", unclaimed, href("deactivate")],
    ["archive", unclaimed, href("delete")],
    ["assign administrator", unclaimed, href("assign-admin")],
    ["issue claim link", unclaimed, "Issue claim link"],
    ["protocol settings", unclaimed, ">Protocol settings<"],
    ["reactivate", pendingActivation, href("reactivate")],
    ["re-issue activation link", pendingActivation, "Re-issue activation link"],
    ["assign administrator (expired invitation)", pendingActivation, href("assign-admin")],
    ["reset administrator MFA", pendingActivation, ">Reset MFA</button>"],
  ])("%s is hidden", async (_name, org, marker) => {
    const { html } = await render(org);
    expect(html).toContain(">Deleted<");
    expect(html).not.toContain(marker);
  });

  it.each([
    ["unclaimed", unclaimed],
    ["pending activation", pendingActivation],
  ])("Restore stays, %s", async (_n, org) => {
    const { html } = await render(org);
    expect(html).toContain(href("restore"));
  });

  it("the org_admin's own organization maps deleted_at to deleted too", async () => {
    const { getOwnOrganization } = await import("@/lib/idp-admin-client");
    installExport("/org-admin", {
      ...answers,
      "GET /api/v1/organizations/current": {
        json: {
          ...(answers["GET /api/v1/organizations/current"] as { json: object }).json,
          ...archived,
        },
      },
    });
    expect((await getOwnOrganization())?.deleted).toBe(true);
  });
});
