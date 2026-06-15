/**
 * Regression sentry for identuum-20260528-validate-session-mfa-projection-coupling.
 *
 * The org-admin layout (src/app/org-admin/layout.tsx) reads the
 * IdP-authoritative `mfa_enabled` field off the validate-session
 * response and redirects org_admin sessions to /account/settings when
 * the field is explicitly `false`. Before the IdP validate-session
 * handler was fixed to project user.MFAEnabled into the response
 * struct, every session looked like `mfa_enabled=false` and freshly
 * enrolled org_admins were bounced into the password-change form.
 *
 * These tests pin the three states the gate cares about:
 *   - mfa_enabled === false      → redirect to /account/settings?reason=mfa_required
 *   - mfa_enabled === true       → no redirect (layout renders normally)
 *   - mfa_enabled === undefined  → no redirect (older IdP builds tolerated)
 *
 * The layout is an async Server Component; we exercise it as a plain
 * async function with mocked dependencies. We do not assert on the
 * rendered JSX — only on whether `redirect` was called and with what
 * argument — because the gate logic is the load-bearing behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next/navigation`'s redirect() throws in real Next.js. We capture the
// argument as a sentinel error so tests can assert both that the
// redirect fired and what URL it targeted.
class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`redirect: ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSentinel(url);
  },
}));

// runtime-config gates the layout's "IdP enabled?" branch. We feed it
// a fully-configured config so the gate falls through to the session
// checks under test.
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://localhost:7104",
    idp: { enabled: true, public_base_url: "http://localhost:7113" },
    ag: { enabled: false, public_base_url: "" },
  }),
}));

// roleToPath is only invoked when the session role is *not* org_admin,
// which we don't hit in any of these test rows. Stubbing it keeps the
// import graph satisfied without depending on the real implementation.
vi.mock("../lib/role-routing", () => ({
  roleToPath: (role: string | null) => `/login?reason=wrong_role&role=${role ?? "none"}`,
}));

// The layout's session source. Each test below stubs the return value
// before calling the layout.
const mockGetServerSession = vi.fn();
vi.mock("../lib/server-session", () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: () =>
    Promise.resolve({
      components: { idp: { capabilities: {} } },
    }),
}));

// Child components are not relevant to gate behavior. Replacing them
// with cheap no-ops keeps the test isolated from their internals
// (and from React rendering side-effects in the node environment).
vi.mock("../components/org-admin/org-admin-nav", () => ({ OrgAdminNav: () => null }));
vi.mock("../components/shared/account-menu", () => ({ AccountMenu: () => null }));

import OrgAdminLayout from "../app/org-admin/layout";

const orgAdminSessionWith = (overrides: Record<string, unknown> = {}) => ({
  role: "org_admin",
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    role: "org_admin",
    organization_id: "00000000-0000-0000-0000-000000000002",
    ...overrides,
  },
});

describe("OrgAdminLayout — MFA setup gate", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /account/settings?reason=mfa_required when mfa_enabled is explicitly false", async () => {
    mockGetServerSession.mockResolvedValue(orgAdminSessionWith({ mfa_enabled: false }));

    let captured: RedirectSentinel | null = null;
    try {
      // Children are not rendered when the gate trips; pass an empty fragment.
      await OrgAdminLayout({ children: null });
    } catch (e) {
      if (e instanceof RedirectSentinel) captured = e;
      else throw e;
    }

    expect(captured).not.toBeNull();
    expect(captured?.url).toBe("/account/settings?reason=mfa_required");
  });

  it("does NOT redirect when mfa_enabled is true (the post-enrollment success path)", async () => {
    mockGetServerSession.mockResolvedValue(orgAdminSessionWith({ mfa_enabled: true }));

    // No redirect should fire; the layout returns its JSX tree.
    const result = await OrgAdminLayout({ children: null });
    // Async Server Components return a JSX element. We don't render it
    // (no React DOM in node env) — only assert that we reached the
    // rendering path instead of throwing a RedirectSentinel.
    expect(result).toBeDefined();
  });

  it("does NOT redirect when mfa_enabled is absent (older IdP builds)", async () => {
    // No mfa_enabled key at all — session.user?.mfa_enabled === undefined.
    // The gate must use strict `=== false` so absent values do not lock
    // working operators out during rolling upgrades.
    mockGetServerSession.mockResolvedValue(orgAdminSessionWith());

    const result = await OrgAdminLayout({ children: null });
    expect(result).toBeDefined();
  });

  it("still redirects unauthenticated sessions to /login (sanity check the earlier gate)", async () => {
    mockGetServerSession.mockResolvedValue(null);

    let captured: RedirectSentinel | null = null;
    try {
      await OrgAdminLayout({ children: null });
    } catch (e) {
      if (e instanceof RedirectSentinel) captured = e;
      else throw e;
    }

    expect(captured).not.toBeNull();
    expect(captured?.url).toBe("/login?reason=session_expired");
  });
});
