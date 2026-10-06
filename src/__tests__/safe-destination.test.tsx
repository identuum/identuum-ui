/**
 * UI-SEC-HEADERS (review UI-XSS-REVIEW-2026-10-06, L1): client navigation
 * checks its destinations instead of trusting the backend's URL construction.
 *
 *   - SSO: the login flow navigates only to a same-origin URL on the SSO
 *     initiation route (/api/v1/auth/idp/<id>/login, OSS oidcLoginURL);
 *     another origin, javascript:, data: and any other path are refused.
 *   - Activation link: shown as a link only when it is https, or on the
 *     console's own origin; otherwise it is plain text.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clickableAccountLink, ssoLoginDestination } from "@/lib/safe-destination";

vi.mock("server-only", () => ({}));
vi.mock("@/app/site-admin/organizations/new/actions", () => ({
  createOrgAction: async () => ({}),
}));

const ORIGIN = "https://console.example.test";
const IDP = "/api/v1/auth/idp/0190a000-0000-7000-8000-000000000001/login";

describe("ssoLoginDestination [L1]", () => {
  it("accepts the same-origin SSO initiation route, relative or absolute", () => {
    expect(ssoLoginDestination(IDP, ORIGIN)?.href).toBe(`${ORIGIN}${IDP}`);
    expect(ssoLoginDestination(`${ORIGIN}${IDP}`, ORIGIN)?.href).toBe(`${ORIGIN}${IDP}`);
  });

  it.each([
    ["another origin", `https://outside.example${IDP}`],
    ["a protocol-relative URL", `//outside.example${IDP}`],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<p>x</p>"],
    ["http on an https console", `http://console.example.test${IDP}`],
    ["another same-origin path", "/api/v1/auth/login"],
    ["a path that only contains the route", `/x${IDP}`],
    ["a dot-segment escape", "/api/v1/auth/idp/../../../admin/login"],
    ["an empty value", ""],
  ])("refuses %s", (_name, url) => {
    expect(ssoLoginDestination(url, ORIGIN)).toBeNull();
  });
});

describe("clickableAccountLink [L1]", () => {
  it("allows https anywhere, and http only on the console's own origin", () => {
    expect(clickableAccountLink("https://idp.example.test/activate?token=t", undefined)).toBe(true);
    expect(
      clickableAccountLink("http://localhost:7113/activate?token=t", "http://localhost:7113")
    ).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)", ORIGIN],
    ["data:", "data:text/html,x", ORIGIN],
    ["http on another origin", "http://outside.example/activate?token=t", ORIGIN],
    ["http with no known origin", "http://localhost:7113/activate?token=t", undefined],
    ["a relative value", "/activate?token=t", ORIGIN],
    ["not a URL", "not a url", ORIGIN],
  ])("refuses %s", (_name, link, origin) => {
    expect(clickableAccountLink(link, origin)).toBe(false);
  });
});

describe("the call sites use the checks [L1]", () => {
  it("the org-create success panel links only a clickable activation URL, else shows text", async () => {
    const { SuccessPanel } = await import("@/app/site-admin/organizations/new/form-client");
    const base = {
      orgId: "o1",
      orgName: "Org",
      orgDomain: "org.test",
      adminEmail: "admin@org.test",
      activationToken: "tok",
    };
    const https = renderToStaticMarkup(
      <SuccessPanel
        success={{ ...base, activationUrl: "https://idp.example.test/activate?token=tok" }}
      />
    );
    expect(https).toContain('href="https://idp.example.test/activate?token=tok"');

    for (const bad of ["javascript:alert(1)", "http://outside.example/activate?token=tok"]) {
      const html = renderToStaticMarkup(<SuccessPanel success={{ ...base, activationUrl: bad }} />);
      expect(html, bad).not.toContain(`href="${bad}"`);
      expect(html, bad).toContain(`select-all">${bad}</p>`);
    }
  });

  it("the login flow's SSO redirect goes through ssoLoginDestination", () => {
    const src = readFileSync(resolve(__dirname, "../components/auth/login-flow.tsx"), "utf8");
    const body = src.slice(
      src.indexOf("const handleSSORedirect"),
      src.indexOf("const handleMfaRequired")
    );
    expect(body).toContain("ssoLoginDestination(loginUrl, window.location.origin)");
    expect(body).not.toMatch(/new URL\(loginUrl/);
  });
});
