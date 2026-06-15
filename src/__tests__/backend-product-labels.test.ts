/**
 * Tests for backend product label derivation.
 *
 * Each backend reports its identity differently in /health responses:
 *
 *   identuum-ag-oss:       {"product":"identuum-ag-oss","status":"ok"}
 *   identuum-idp (CE):     {"status":"healthy","version":"…","product":"identuum-idp-ce",…}
 *   identuum-idp (OSS):    {"status":"healthy","version":"…","mode":"oss","tier":"starter"}
 *   identuum-idp (monolith):{"status":"healthy","version":"…","product":"identuum-idp",…}
 *   identuum-ag (monolith): {"surface":"management","ok":true}  — no product/mode
 *
 * These tests pin the derivation logic so split-runtime deployments show the
 * correct product name and never fall back to hardcoded "identuum-idp" /
 * "identuum-ag" labels when the backend actually identifies itself.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveProductLabel } from "../lib/backend-product-labels";

// ── deriveProductLabel — unit tests ─────────────────────────────────────────

describe("deriveProductLabel — IDP domain", () => {
  it("uses product field when present (IDP monolith)", () => {
    const body = {
      status: "healthy",
      version: "0.7.0",
      product: "identuum-idp",
      is_air_gapped: false,
    };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp");
  });

  it("uses product field when present (IDP CE / pro tier)", () => {
    const body = { status: "healthy", version: "0.7.0", product: "identuum-idp-pro" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp-pro");
  });

  it("uses product field for identuum-idp-ce", () => {
    const body = { status: "healthy", product: "identuum-idp-ce" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp-ce");
  });

  it("derives identuum-idp-oss from mode=oss when product is absent (IDP OSS)", () => {
    const body = { status: "healthy", version: "0.1.0", mode: "oss", tier: "starter" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp-oss");
  });

  it("derives identuum-idp-ce from mode=ce when product is absent", () => {
    const body = { status: "healthy", mode: "ce" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp-ce");
  });

  it("falls back to identuum-idp when body has no product or mode", () => {
    const body = { status: "healthy" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp");
  });

  it("falls back to identuum-idp for null body", () => {
    expect(deriveProductLabel("idp", null)).toBe("identuum-idp");
  });

  it("falls back to identuum-idp for undefined body", () => {
    expect(deriveProductLabel("idp", undefined)).toBe("identuum-idp");
  });

  it("falls back to identuum-idp for non-JSON body (string)", () => {
    expect(deriveProductLabel("idp", "ok")).toBe("identuum-idp");
  });

  it("falls back to identuum-idp for array body", () => {
    expect(deriveProductLabel("idp", [])).toBe("identuum-idp");
  });

  it("prefers product over mode when both are present", () => {
    const body = { product: "identuum-idp-ce", mode: "oss" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp-ce");
  });

  it("falls back to identuum-idp when product is empty string", () => {
    const body = { product: "" };
    expect(deriveProductLabel("idp", body)).toBe("identuum-idp");
  });
});

describe("deriveProductLabel — AG domain", () => {
  it("uses product field when present (AG OSS)", () => {
    const body = { product: "identuum-ag-oss", status: "ok" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag-oss");
  });

  it("uses product field for identuum-ag-ce", () => {
    const body = { product: "identuum-ag-ce", status: "ok" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag-ce");
  });

  it("derives identuum-ag-oss from mode=oss when product is absent", () => {
    const body = { status: "ok", mode: "oss" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag-oss");
  });

  it("derives identuum-ag-ce from mode=ce when product is absent", () => {
    const body = { status: "ok", mode: "ce" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag-ce");
  });

  it("falls back to identuum-ag for AG monolith (surface+ok shape, no product/mode)", () => {
    const body = { surface: "management", ok: true };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag");
  });

  it("falls back to identuum-ag for null body", () => {
    expect(deriveProductLabel("ag", null)).toBe("identuum-ag");
  });

  it("falls back to identuum-ag when body has no product or mode", () => {
    const body = { status: "ok" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag");
  });

  it("prefers product over mode when both are present", () => {
    const body = { product: "identuum-ag-ce", mode: "oss" };
    expect(deriveProductLabel("ag", body)).toBe("identuum-ag-ce");
  });
});

// ── Source-invariant tests — status route and client ─────────────────────────

const STATUS_SRC = readFileSync(
  resolve(__dirname, "..", "app", "api", "status", "route.ts"),
  "utf-8"
);

const CLIENT_SRC = readFileSync(
  resolve(__dirname, "..", "app", "site-admin", "client.tsx"),
  "utf-8"
);

describe("status route — uses deriveProductLabel from backend-product-labels", () => {
  it("imports deriveProductLabel", () => {
    expect(STATUS_SRC).toMatch(/import.*deriveProductLabel.*from.*backend-product-labels/);
  });

  it("calls deriveProductLabel in checkHealth", () => {
    expect(STATUS_SRC).toContain("deriveProductLabel(domain, body)");
  });

  it("passes parsed body to deriveProductLabel (not raw text)", () => {
    // The route must call res.json() before deriveProductLabel, not pass the
    // response string directly.
    expect(STATUS_SRC).toContain("res.json()");
  });

  it("includes identuum-idp fallback for unconfigured IDP", () => {
    expect(STATUS_SRC).toContain('"identuum-idp"');
  });

  it("includes identuum-ag fallback for unconfigured AG", () => {
    expect(STATUS_SRC).toContain('"identuum-ag"');
  });
});

describe("site-admin client — uses status.idp.product and status.ag.product as labels", () => {
  it("reads status.idp.product for the IDP label", () => {
    expect(CLIENT_SRC).toContain("status.idp.product");
  });

  it("reads status.ag.product for the AG label", () => {
    expect(CLIENT_SRC).toContain("status.ag.product");
  });

  it("does not hardcode identuum-idp as a static label string in CapabilityRow or HealthRow", () => {
    // The static string "identuum-idp" may still appear as a fallback default in
    // status?.idp.product ?? "identuum-idp" — that is intentional. What must NOT
    // happen is a static label prop like: label="identuum-idp".
    expect(CLIENT_SRC).not.toMatch(/label="identuum-idp"/);
    expect(CLIENT_SRC).not.toMatch(/label="identuum-ag"/);
  });

  it("does not hardcode identuum-idp-oss as a static label string", () => {
    expect(CLIENT_SRC).not.toMatch(/label="identuum-idp-oss"/);
    expect(CLIENT_SRC).not.toMatch(/label="identuum-ag-oss"/);
  });

  it("uses status?.idp.product ?? fallback for capability row (tolerates null status)", () => {
    expect(CLIENT_SRC).toContain("status?.idp.product");
    expect(CLIENT_SRC).toContain("status?.ag.product");
  });
});
