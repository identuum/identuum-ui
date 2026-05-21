/**
 * E2E tests for /platform-status and the /api/runtime JSON endpoint.
 *
 * Architecture note:
 *   /platform-status is a fully server-rendered (RSC) page. It calls backend
 *   /api/v1/component endpoints directly from the Next.js server process —
 *   not from the browser. page.route() intercepts browser-context fetches
 *   only; it cannot intercept Node.js server-side fetch calls.
 *
 *   All 7 PlatformMode permutation tests therefore live in the unit test suite
 *   (src/__tests__/runtime-composition.test.ts, 756 passing) where fetch is
 *   stub-able with vi.stubGlobal.
 *
 *   These E2E tests cover:
 *     1. Page renders at all (HTTP 200, basic structure).
 *     2. /api/runtime returns a valid RuntimeState JSON contract.
 *     3. Live mode badge matches the /api/runtime mode field.
 *     4. Backend cards show expected status rows.
 *     5. Page title and navigation link are present.
 */

import { expect, test } from "@playwright/test";
import type { RuntimeState } from "../src/lib/types";

test.describe("/platform-status — page structure", () => {
  test("page renders without error and shows Platform Status heading", async ({ page }) => {
    const res = await page.goto("/platform-status");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Platform Status" })).toBeVisible();
  });

  test("page shows the backend discovery description", async ({ page }) => {
    await page.goto("/platform-status");
    await expect(
      page.getByText("Live discovery state of configured Identuum backends.")
    ).toBeVisible();
  });

  test("page always shows Return to home link", async ({ page }) => {
    await page.goto("/platform-status");
    await expect(page.getByRole("link", { name: "Return to home" })).toBeVisible();
  });

  test("IDP backend card is present", async ({ page }) => {
    await page.goto("/platform-status");
    await expect(page.getByText("Identity (IDP)")).toBeVisible();
  });

  test("AG backend card is present", async ({ page }) => {
    await page.goto("/platform-status");
    await expect(page.getByText("Agent Governance (AG)")).toBeVisible();
  });
});

test.describe("/platform-status — mode badge matches /api/runtime", () => {
  test("live mode badge label corresponds to /api/runtime mode", async ({ page, request }) => {
    // Fetch the live runtime mode from the JSON API.
    const apiRes = await request.get("/api/runtime");
    expect(apiRes.status()).toBe(200);
    const body = (await apiRes.json()) as RuntimeState;
    expect(typeof body.mode).toBe("string");

    // Expected badge label for each PlatformMode value.
    const modeLabel: Record<string, string> = {
      "full-platform": "Full Platform",
      "identity-only": "Identity Only",
      "agent-governance-only": "Agent Governance Only",
      "degraded-idp-unavailable": "Degraded — Identity Unavailable",
      "degraded-ag-unavailable": "Degraded — AG Unavailable",
      misconfigured: "Misconfigured",
      unconfigured: "Unconfigured",
    };

    const expectedLabel = modeLabel[body.mode];
    expect(expectedLabel, `Unknown mode returned by /api/runtime: ${body.mode}`).toBeDefined();

    await page.goto("/platform-status");
    await expect(page.getByText(expectedLabel)).toBeVisible();
  });
});

test.describe("/api/runtime — JSON contract", () => {
  test("returns 200 with valid RuntimeState shape", async ({ request }) => {
    const res = await request.get("/api/runtime");
    expect(res.status()).toBe(200);

    const body = (await res.json()) as RuntimeState;

    // Top-level mode field is one of the 7 known PlatformMode values.
    const validModes = [
      "full-platform",
      "identity-only",
      "agent-governance-only",
      "degraded-idp-unavailable",
      "degraded-ag-unavailable",
      "misconfigured",
      "unconfigured",
    ];
    expect(validModes).toContain(body.mode);

    // components.idp shape
    expect(typeof body.components.idp.configured).toBe("boolean");
    expect(typeof body.components.idp.reachable).toBe("boolean");
    expect(typeof body.components.idp.usable).toBe("boolean");
    expect(typeof body.components.idp.capabilities).toBe("object");
    expect(typeof body.components.idp.license.status).toBe("string");

    // components.ag shape
    expect(typeof body.components.ag.configured).toBe("boolean");
    expect(typeof body.components.ag.reachable).toBe("boolean");
    expect(typeof body.components.ag.usable).toBe("boolean");
    expect(typeof body.components.ag.capabilities).toBe("object");
    expect(typeof body.components.ag.license.status).toBe("string");
  });

  test("response never contains internal_base_url", async ({ request }) => {
    const res = await request.get("/api/runtime");
    const text = await res.text();
    expect(text).not.toContain("internal_base_url");
  });

  test("response never contains secret, password, or private_key", async ({ request }) => {
    const res = await request.get("/api/runtime");
    const text = await res.text();
    expect(text).not.toContain("password");
    expect(text).not.toContain("private_key");
    expect(text).not.toContain("secret");
  });

  test("IDP component field matches expected value when IDP is usable", async ({ request }) => {
    const res = await request.get("/api/runtime");
    const body = (await res.json()) as RuntimeState;

    if (body.components.idp.usable) {
      expect(body.components.idp.component).toBe("identuum-idp");
      expect(body.components.idp.version).toBeTruthy();
    }
  });

  test("AG component field matches expected value when AG is usable", async ({ request }) => {
    const res = await request.get("/api/runtime");
    const body = (await res.json()) as RuntimeState;

    if (body.components.ag.usable) {
      expect(body.components.ag.component).toBe("identuum-ag");
      expect(body.components.ag.version).toBeTruthy();
    }
  });
});

test.describe("/platform-status — backend card status rows", () => {
  test("page shows at least one Operational label when IDP is usable", async ({
    page,
    request,
  }) => {
    const apiRes = await request.get("/api/runtime");
    const body = (await apiRes.json()) as RuntimeState;

    if (!body.components.idp.usable) {
      test.skip();
      return;
    }

    await page.goto("/platform-status");
    // When IDP is usable there is at least one "Operational" label on the page.
    await expect(page.getByText("Operational").first()).toBeVisible();
  });

  test("IDP card shows version when IDP is usable", async ({ page, request }) => {
    const apiRes = await request.get("/api/runtime");
    const body = (await apiRes.json()) as RuntimeState;

    if (!body.components.idp.usable || !body.components.idp.version) {
      test.skip();
      return;
    }

    await page.goto("/platform-status");
    await expect(page.getByText(body.components.idp.version!)).toBeVisible();
  });
});
