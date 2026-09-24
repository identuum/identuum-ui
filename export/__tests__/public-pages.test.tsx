import { afterEach, describe, expect, it, vi } from "vitest";
import { completeActivationAction } from "@/app/activate/actions";
import { requestPasswordResetAction } from "@/app/forgot-password/actions";
import { consumeResetTokenAction } from "@/app/reset-password/actions";
import { nextProxyFetch } from "../src/next-proxy";
import { ExportRedirect } from "../src/platform/next-navigation";
import { isServerRoute } from "../src/server-routes";
import { installExport, type Routes, session } from "./harness";

// PLAN-D-4: the public ceremony and appliance-state pages, and the org_user
// dashboard's security redirect, as the export renders them — the SAME page
// and action modules as Next (export/src/public-routes.tsx). Their IdP calls
// are the binary's public routes, reached directly: the boundary lifts a
// cookie, and these requests need none.

afterEach(() => vi.unstubAllGlobals());

const TOKEN = "t0k3n-fixture";

async function render(path: string, routes: Routes = {}) {
  const env = installExport(path, routes);
  // The browser adapter for the Next IdP proxy path, as main.tsx installs it.
  vi.stubGlobal("fetch", nextProxyFetch(globalThis.fetch));
  return { ...(await env.render()), env };
}

async function act<S>(routes: Routes, run: () => Promise<S>) {
  const env = installExport("/", routes);
  try {
    return { result: await run(), redirectedTo: null as string | null, env };
  } catch (error) {
    if (error instanceof ExportRedirect) return { result: null, redirectedTo: error.to, env };
    throw error;
  }
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const direct = (env: ReturnType<typeof installExport>, path: string) =>
  env.calls.find((c) => c.path.split("?")[0] === path);

it("every converted page is routed through the shared tree", () => {
  for (const p of [
    "/activate",
    "/claim",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/upgrade",
    "/setup-required",
    "/dashboard/security",
  ]) {
    expect(isServerRoute(p), p).toBe(true);
  }
});

describe("activate", () => {
  const VALIDATE = `GET /api/v1/auth/organizations/activate/${TOKEN}`;

  it("a valid link renders the form for the administrator it names, read directly", async () => {
    const { html, env } = await render(`/activate?token=${TOKEN}`, {
      [VALIDATE]: { json: { success: true, email: "admin@tenant.test" } },
    });
    expect(html).toContain("admin@tenant.test");
    expect(html).toContain('name="password"');
    expect(direct(env, VALIDATE.slice(4))).toMatchObject({ viaBff: false });
  });

  it.each([
    [404, "Link invalid or expired"],
    [409, "Organization already activated"],
  ])("a %s answer is %s, never a form", async (status, text) => {
    const { html } = await render(`/activate?token=${TOKEN}`, { [VALIDATE]: { status, json: {} } });
    expect(html).toContain(text);
    expect(html).not.toContain('name="password"');
  });

  it("no token is the missing-link panel and asks the IdP nothing", async () => {
    const { html, env } = await render("/activate");
    expect(html).toContain("No activation link provided");
    expect(env.calls).toHaveLength(0);
  });

  it("completing activation POSTs directly and hands the pending session to MFA enrolment", async () => {
    const { result, env } = await act(
      {
        [VALIDATE]: { json: { success: true, email: "admin@tenant.test" } },
        "POST /api/v1/auth/organizations/activate": { json: { success: true } },
        "POST /api/v1/auth/login": {
          status: 401,
          json: { mfa_required: true, mfa_enrollment_required: true, session_id: "pending-1" },
        },
      },
      () =>
        completeActivationAction(
          { phase: "form" },
          form({ token: TOKEN, password: "Str0ng!Passw0rd", confirm: "Str0ng!Passw0rd" })
        )
    );
    expect(result).toMatchObject({ phase: "mfa_setup", sessionId: "pending-1" });
    expect(direct(env, "/api/v1/auth/organizations/activate")).toMatchObject({
      method: "POST",
      viaBff: false,
    });
  });
});

describe("claim", () => {
  const VALIDATE = "GET /api/v1/auth/claim/validate";

  it("a valid claim link names its organization, read directly", async () => {
    const { html, env } = await render(`/claim?token=${TOKEN}`, {
      [VALIDATE]: {
        json: { valid: true, organization_name: "Tenant Claim", target_email: "c@tenant.test" },
      },
    });
    expect(html).toContain("Tenant Claim");
    expect(direct(env, "/api/v1/auth/claim/validate")).toMatchObject({ viaBff: false });
  });

  it("an invalid claim link renders no form", async () => {
    const { html } = await render(`/claim?token=${TOKEN}`, {
      [VALIDATE]: { json: { valid: false } },
    });
    expect(html).not.toContain('name="password"');
  });
});

describe("forgot and reset password", () => {
  it("forgot-password renders its form", async () => {
    const { html, env } = await render("/forgot-password");
    expect(html).toContain(">Forgot password</h1>");
    expect(html).toContain('name="email"');
    expect(env.calls).toHaveLength(0);
  });

  it("a reset request POSTs directly and always ends in the same sent state", async () => {
    for (const status of [200, 404]) {
      const { result, env } = await act(
        { "POST /api/v1/auth/password/reset-request": { status, json: {} } },
        () => requestPasswordResetAction({ phase: "form" }, form({ email: "who@tenant.test" }))
      );
      expect(result).toEqual({ phase: "sent" });
      expect(direct(env, "/api/v1/auth/password/reset-request")).toMatchObject({
        viaBff: false,
        body: { email: "who@tenant.test" },
      });
    }
  });

  it("reset-password renders its form for a token", async () => {
    const { html } = await render(`/reset-password?token=${TOKEN}`);
    expect(html).toContain(">Reset password</h1>");
    expect(html).toContain('name="newPassword"');
  });

  it("a reset POSTs the token and the new password directly", async () => {
    const { env } = await act({ "POST /api/v1/auth/password/reset": { json: {} } }, () =>
      consumeResetTokenAction(
        { phase: "form" },
        form({ token: TOKEN, newPassword: "N3w!Passw0rd-x", confirmPassword: "N3w!Passw0rd-x" })
      )
    );
    expect(direct(env, "/api/v1/auth/password/reset")).toMatchObject({
      viaBff: false,
      body: { token: TOKEN, new_password: "N3w!Passw0rd-x" },
    });
  });
});

describe("verify-email", () => {
  it.each([
    [{ json: { verified: true } }, "Email verified"],
    [{ status: 400, json: { error: "invalid_token" } }, "Link invalid or expired"],
  ])("%j renders %s", async (answer, text) => {
    const { html, env } = await render(`/verify-email?token=${TOKEN}`, {
      "GET /api/v1/auth/verify-email": answer,
    });
    expect(html).toContain(text);
    expect(direct(env, "/api/v1/auth/verify-email")).toMatchObject({ viaBff: false });
  });
});

describe("appliance-state pages", () => {
  it("setup-required renders", async () => {
    const { html } = await render("/setup-required");
    expect(html).toContain("Setup required");
  });

  it("upgrade reads the binary's upgrade status through the proxy path, directly", async () => {
    const { html, env } = await render("/upgrade", {
      "GET /api/upgrade/status": { status: 404, json: {} },
    });
    expect(html).toContain("Upgrade");
    expect(direct(env, "/api/upgrade/status")).toMatchObject({ viaBff: false, proof: false });
  });
});

describe("dashboard/security", () => {
  it("sends an org_user to the passkeys tab of their account settings", async () => {
    const { redirectedTo } = await render("/dashboard/security", {
      "GET /api/v1/validate": { json: session("org_user") },
      "GET /api/v1/profile": { json: {} },
    });
    expect(redirectedTo).toBe("/account/settings?tab=passkeys");
  });
});
