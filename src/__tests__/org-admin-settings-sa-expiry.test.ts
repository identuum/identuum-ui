/**
 * OSS-SA-EXPIRY-2 (owner rulings e and g, 2026-10-06): an org_admin views and
 * sets "Service account expiry (days)" for their own organization on
 * /org-admin/settings — 0 = no expiry, 1 to 3650 days, applies only to service
 * accounts created after it is set. A site_admin's organization edit never
 * sends it. Synthetic responses only; no real IdP is called.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: {
      enabled: true,
      public_base_url: "http://idp.test",
      internal_base_url: "http://idp.test",
    },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

import {
  describeServiceAccountExpiry,
  ORG_ADMIN_SA_EXPIRY_COPY,
  parseServiceAccountExpiryDays,
} from "../app/org-admin/settings/settings-helpers";
import { getOwnOrganization, updateOrganization } from "../lib/idp-admin-client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("parseServiceAccountExpiryDays — 0 to 3650 whole days", () => {
  it("accepts 0 (no expiry), 30 and 3650", () => {
    expect(parseServiceAccountExpiryDays("0")).toEqual({ ok: true, value: 0 });
    expect(parseServiceAccountExpiryDays("30")).toEqual({ ok: true, value: 30 });
    expect(parseServiceAccountExpiryDays(" 3650 ")).toEqual({ ok: true, value: 3650 });
  });

  it("refuses values outside 0 to 3650, fractions, signs and non-numbers with the range message", () => {
    for (const raw of ["-1", "3651", "1.5", "abc", "", "+5", "1e3", "07x"]) {
      expect(parseServiceAccountExpiryDays(raw), raw).toEqual({
        ok: false,
        error: ORG_ADMIN_SA_EXPIRY_COPY.rangeError,
      });
    }
  });
});

describe("describeServiceAccountExpiry — the stored value in words", () => {
  it("says no expiry for 0, singular for 1, plural otherwise, and not reported when absent", () => {
    expect(describeServiceAccountExpiry(0)).toBe("No expiry");
    expect(describeServiceAccountExpiry(1)).toBe("1 day");
    expect(describeServiceAccountExpiry(30)).toBe("30 days");
    expect(describeServiceAccountExpiry(undefined)).toBe("Not reported");
  });
});

describe("ORG_ADMIN_SA_EXPIRY_COPY — operator copy", () => {
  it("names the field and explains 0 and that only new service accounts are affected", () => {
    expect(ORG_ADMIN_SA_EXPIRY_COPY.label).toBe("Service account expiry (days)");
    expect(ORG_ADMIN_SA_EXPIRY_COPY.help).toMatch(/0 means no expiry/i);
    expect(ORG_ADMIN_SA_EXPIRY_COPY.help).toMatch(/only to service accounts created after/i);
    expect(ORG_ADMIN_SA_EXPIRY_COPY.rangeError).toMatch(/0 to 3650/);
  });
});

describe("the IdP client carries the field", () => {
  it("getOwnOrganization reads service_account_expiry_days and keeps absence as undefined", async () => {
    answer(200, { id: "o1", name: "Acme", service_account_expiry_days: 30 });
    expect((await getOwnOrganization())?.service_account_expiry_days).toBe(30);
    answer(200, { id: "o1", name: "Acme" });
    expect((await getOwnOrganization())?.service_account_expiry_days).toBeUndefined();
  });

  it("updateOrganization sends service_account_expiry_days, and returns the API's message on a refusal", async () => {
    const ok = answer(200, { id: "o1", name: "Acme" });
    const saved = await updateOrganization("o1", { service_account_expiry_days: 30 });
    expect(saved.ok).toBe(true);
    const [, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ service_account_expiry_days: 30 });

    answer(400, {
      error: "invalid request",
      message: "service_account_expiry_days must be between 0 (perpetual) and 3650",
    });
    const refused = await updateOrganization("o1", { service_account_expiry_days: 3651 });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.status).toBe(400);
    expect(refused.message).toBe(
      "service_account_expiry_days must be between 0 (perpetual) and 3650"
    );
  });
});

describe("wiring — org_admin page, form and action; never the site_admin edit", () => {
  const read = (...p: string[]) => readFileSync(resolve(__dirname, "..", ...p), "utf-8");
  const PAGE = read("app", "org-admin", "settings", "page.tsx");
  const ACTIONS = read("app", "org-admin", "settings", "actions.ts");
  const FORM = read("components", "org-admin", "service-account-expiry-form.tsx");
  const SITE_ADMIN_EDIT = read("app", "site-admin", "organizations", "[id]", "edit", "actions.ts");
  const SITE_ADMIN_FORM = read(
    "app",
    "site-admin",
    "organizations",
    "[id]",
    "edit",
    "form-client.tsx"
  );

  it("the settings page renders the form with the stored value", () => {
    expect(PAGE).toMatch(
      /<ServiceAccountExpiryForm\s+currentDays=\{org\?\.service_account_expiry_days\}/
    );
  });

  it("the action is org_admin-only, takes the organization from the session and saves through updateOrganization", () => {
    const fn = ACTIONS.slice(
      ACTIONS.indexOf("export async function updateServiceAccountExpiryAction")
    );
    expect(fn).toMatch(/role !== "org_admin"/);
    expect(fn).toMatch(/getOwnOrganization\(\)/);
    expect(fn).toMatch(/parseServiceAccountExpiryDays\(/);
    expect(fn).toMatch(/updateOrganization\(org\.id, \{ service_account_expiry_days:/);
    expect(fn).toMatch(/result\.message/);
  });

  it("the form posts the field to that action and leaves range checks to it (noValidate)", () => {
    expect(FORM).toMatch(/updateServiceAccountExpiryAction/);
    expect(FORM).toMatch(/name="service_account_expiry_days"/);
    expect(FORM).toMatch(/noValidate/);
  });

  it("a site_admin's organization edit never sends or offers the field", () => {
    expect(SITE_ADMIN_EDIT).not.toMatch(/service_account_expiry_days/);
    expect(SITE_ADMIN_FORM).not.toMatch(/service_account_expiry_days/);
  });
});
