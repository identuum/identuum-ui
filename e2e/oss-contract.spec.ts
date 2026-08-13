/**
 * OSS runtime-contract spec — the SHIPPED surface, positively pinned.
 *
 * REWRITTEN THE-RELEASED-CONTRACT (2026-08-08). This spec used to declare the
 * `--gin-serve` scaffold contract — verbatim "No auth, no /authorize, no
 * /token" — and its two negative pins passed VACUOUSLY against every released
 * build: they probed the bare paths `/authorize` and `/token`, which 404
 * regardless, and asserted only "not 200". identuum-idp-oss v0.3.0 is the full
 * OAuth 2.1 / OIDC Authorization Server; the scaffold that framing described
 * was retired before v0.2.0, and the OSS repo's own
 * TestOSSContract_NoScaffoldFraming now BANS that string from its main.go. A
 * contract spec that certifies the absence of the product's core feature, and
 * passes because it aims at paths the product never served, is drift, not a
 * contract. It now pins the surface the released artifact actually serves,
 * discovered from the discovery document.
 *
 * Positive pins (must be present — a dead port or a non-IDP backend fails all):
 *   - GET /health                            → 200 status:"healthy"
 *   - GET /.well-known/openid-configuration  → 200 with issuer + the three
 *                                              OAuth endpoints
 *   - GET /.well-known/jwks.json             → 200 with a keys array
 *   - GET authorization_endpoint (malformed) → 400 — PRESENT and validating,
 *                                              NOT 404 (absent)
 *   - POST token_endpoint (malformed)        → 401 — PRESENT and client-auth-
 *                                              gated, NOT 404
 *   - POST introspection_endpoint (malformed)→ 401 — PRESENT and client-auth-
 *                                              gated, NOT 404
 *
 * The malformed-request status codes are the tell that separates a SERVED,
 * validating endpoint (4xx) from an ABSENT one (404): the census found the old
 * negatives green against a backend that serves all three, because "not 200"
 * is satisfied by the 404 an absent path returns just as well as by the 400 a
 * present one does. These pins assert the discriminating status directly.
 *
 * What this spec is NOT: not an auth/E2E flow — it issues no token and drives
 * no login. It needs no credentials. It FAILS against a non-IDP backend (404
 * on discovery) and against a dead port (connection refused) — red-proved in
 * THE-RELEASED-CONTRACT by pointing IDENTUUM_IDP_BASE_URL at an unused port.
 *
 * Companion source-invariant pin:
 *   src/__tests__/oss-ce-runtime-target-source-invariants.test.ts
 */

import { expect, test } from "@playwright/test";

const IDP_BASE_URL = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";

interface DiscoveryDoc {
  issuer?: string;
  jwks_uri?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  introspection_endpoint?: string;
}

async function discovery(
  request: import("@playwright/test").APIRequestContext
): Promise<DiscoveryDoc> {
  const res = await request.get(`${IDP_BASE_URL}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  return (await res.json()) as DiscoveryDoc;
}

test.describe("OSS runtime contract — liveness + discovery (must be present)", () => {
  test("GET /health returns 200 with status:healthy", async ({ request }) => {
    const res = await request.get(`${IDP_BASE_URL}/health`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("healthy");
  });

  test("GET /.well-known/openid-configuration advertises issuer + the OAuth endpoints [CONTRACT-SURFACE-1]", async ({
    request,
  }) => {
    const body = await discovery(request);
    expect(typeof body.issuer).toBe("string");
    expect(body.issuer?.length).toBeGreaterThan(0);
    expect(typeof body.jwks_uri).toBe("string");
    // The released Authorization Server advertises all three — the scaffold
    // era advertised none of them.
    expect(typeof body.authorization_endpoint).toBe("string");
    expect(typeof body.token_endpoint).toBe("string");
    expect(typeof body.introspection_endpoint).toBe("string");
  });

  test("GET /.well-known/jwks.json returns 200 with a `keys` array", async ({ request }) => {
    const res = await request.get(`${IDP_BASE_URL}/.well-known/jwks.json`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { keys?: unknown[] };
    expect(Array.isArray(body.keys)).toBe(true);
  });
});

test.describe("OSS runtime contract — the OAuth surface is SERVED", () => {
  test("authorization_endpoint validates a malformed request (400, not 404)", async ({
    request,
  }) => {
    const { authorization_endpoint } = await discovery(request);
    expect(authorization_endpoint).toBeTruthy();
    const res = await request.get(authorization_endpoint as string, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    // A present, validating authorize endpoint rejects a parameterless GET
    // with 400. An ABSENT endpoint would 404. Pinning "400, not 404" is what
    // the old "not 200" pin could not do — it passed on the 404 too.
    expect(res.status(), "authorize must be SERVED and validating (400), not absent (404)").toBe(
      400
    );
  });

  test("token_endpoint is client-auth-gated (401, not 404) [CONTRACT-CLIENT-AUTH-1]", async ({ request }) => {
    const { token_endpoint } = await discovery(request);
    expect(token_endpoint).toBeTruthy();
    const res = await request.post(token_endpoint as string, {
      failOnStatusCode: false,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: "grant_type=client_credentials",
    });
    expect(res.status(), "token must be SERVED and client-auth-gated (401), not absent (404)").toBe(
      401
    );
  });

  test("introspection_endpoint is client-auth-gated (401, not 404)", async ({ request }) => {
    const { introspection_endpoint } = await discovery(request);
    expect(introspection_endpoint).toBeTruthy();
    const res = await request.post(introspection_endpoint as string, {
      failOnStatusCode: false,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: "token=irrelevant",
    });
    expect(
      res.status(),
      "introspection must be SERVED and client-auth-gated (401), not absent (404)"
    ).toBe(401);
  });
});
