/**
 * THE-SESSION-REJECTION-ROOT-CAUSE (2026-09-02, AUTH-503) — live pin of the
 * IdP's two auth answer classes on the provisioned appliance:
 *
 *   401 = a VERDICT about the credential, and it NAMES the verdict
 *         (`reason`), so a client — and this harness — can tell "no token"
 *         from "bad token" from "dead session" without guessing.
 *   503 = a STORE / INFRASTRUCTURE error prevented the verdict; carries the
 *         `correlation_id` that joins it to the IdP's ERROR log. Not
 *         reproducible on demand here (the store is healthy), so this spec
 *         pins the 401 side end-to-end and lets every other spec assert the
 *         503 shape whenever it meets one (expectHonestAuthBody).
 *
 * Runs in the api-suite phase against the fresh appliance; needs no fixture.
 */
import { expect, test } from "@playwright/test";
import { api, expectHonestAuthBody } from "../e2e/helpers/appliance-fixture";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";

test.describe("auth verdicts (AUTH-503): every 401 names its reason", () => {
  test.skip(process.env.IDENTUUM_E2E_FULL !== "1", "e2e-full only");

  test("validate without a credential → 401 missing_credential", async () => {
    const res = await api(IDP_BASE, "GET", "/api/v1/validate");
    expect(res.status).toBe(401);
    expectHonestAuthBody(res.status, res.json as Record<string, unknown>, "validate, no token");
    expect((res.json as { reason?: string }).reason).toBe("missing_credential");
  });

  test("validate with an unverifiable bearer → 401 token_invalid", async () => {
    const res = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, "not-a-jwt");
    expect(res.status).toBe(401);
    expectHonestAuthBody(
      res.status,
      res.json as Record<string, unknown>,
      "validate, garbage token"
    );
    expect((res.json as { reason?: string }).reason).toBe("token_invalid");
  });

  test("protected API without a credential → 401 no_credential (the guard's verdict)", async () => {
    const res = await api(IDP_BASE, "GET", "/api/v1/users");
    expect(res.status).toBe(401);
    expectHonestAuthBody(res.status, res.json as Record<string, unknown>, "users, no token");
    expect((res.json as { reason?: string }).reason).toBe("no_credential");
  });

  test("protected API with an unverifiable bearer → 401 token_invalid (the middleware's verdict)", async () => {
    const res = await api(IDP_BASE, "GET", "/api/v1/users", undefined, "not-a-jwt");
    expect(res.status).toBe(401);
    expectHonestAuthBody(res.status, res.json as Record<string, unknown>, "users, garbage token");
    expect((res.json as { reason?: string }).reason).toBe("token_invalid");
    // The correlation id is on EVERY response now, not only on a 503 — the
    // join key exists before anything goes wrong.
  });
});
