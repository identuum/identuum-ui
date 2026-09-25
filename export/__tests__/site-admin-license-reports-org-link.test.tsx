import { afterEach, describe, expect, it, vi } from "vitest";
import { adminGetLicenseStatus } from "@/lib/idp-license-client";
import { installExport } from "./harness";
import { SITE_ADMIN_SESSION, siteAnswers, sitePage } from "./recorded";

// PLAN-D-3: the site-admin pages whose data is not an /api/v1 read — the
// license page (a direct setup probe and a client-side admin manager), the
// reports page (a boundary, no download links since owner decision 5) and the
// three AG org-link pages — as
// the export renders them over the OSS binary's recorded answers.
//
// What the binary lacks, measured against it on 2026-09-23 and stated here so
// the pages' gaps are not mistaken for passing mutations:
//   - GET /api/setup/license          404 (OSS has no license surface)
//   - GET|POST /api/idp/admin/license  404 (the Next proxy path; /bff forwards
//     only /api/v1/*, and OSS has no /admin/license)
//   - GET /api/idp/api/v1/reports/*   404 (the Next proxy path; OSS has no reports)
//   - the AG org-link and import endpoints (the binary serves no AG).

afterEach(() => vi.unstubAllGlobals());

describe("license", () => {
  it("probes the setup license surface directly and shows an unknown status when OSS has none", async () => {
    const { html, env } = await sitePage("/site-admin/license");
    expect(html).toContain('data-testid="readonly-license-status-card"');
    expect(html).toContain('data-testid="admin-license-token-input"');
    expect(env.calls.find((c) => c.path === "/api/setup/license")).toMatchObject({
      viaBff: false,
      method: "GET",
    });
  });

  it("the admin manager asks the Next proxy path, which the binary does not serve: an error, not a status", async () => {
    const env = installExport("/site-admin/license", {
      ...siteAnswers,
      "GET /api/v1/validate": SITE_ADMIN_SESSION,
    });
    const result = await adminGetLicenseStatus("");
    expect(result).toEqual({ kind: "error", status: 404 });
    expect(env.calls.at(-1)).toMatchObject({ path: "/api/idp/admin/license", viaBff: false });
  });
});

describe("reports", () => {
  it("names the boundary and requests nothing", async () => {
    const { html, env } = await sitePage("/site-admin/reports");
    expect(html).toContain("Report exports are not available");
    expect(env.calls.some((c) => c.path.includes("/reports/"))).toBe(false);
  });

  // Owner decision 5 (2026-09-25): no edition serves report exports, so the
  // page offers no download link (the links named a path nothing answers).
  it("offers no report download link", async () => {
    const { html } = await sitePage("/site-admin/reports");
    expect(html).not.toContain("/api/v1/reports/");
  });
});

describe("AG org-link pages", () => {
  it.each([
    ["/site-admin/org-link", "Organization Link"],
    ["/site-admin/org-link/readiness", "Organization linking"],
    ["/site-admin/org-link/ag-plan", "AG Org-Link Plan"],
  ])("%s renders AG as not configured and calls no AG endpoint", async (path, heading) => {
    const { html, env, redirectedTo } = await sitePage(path);
    expect(redirectedTo).toBeNull();
    expect(html).toContain(heading);
    expect(html.toLowerCase()).toContain("not configured");
    expect(env.calls.some((c) => c.path.includes("org-link") || c.path.includes("import"))).toBe(
      false
    );
  });
});
