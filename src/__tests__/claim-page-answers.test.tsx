/** UI-G9 T3: invoke the page function, then render its real synchronous tree.
 * This is mocked-fetch unit evidence, not a Next server/browser proof.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateClaimToken } from "../app/claim/actions";
import ClaimPage from "../app/claim/page";

const config = vi.hoisted(() => ({ enabled: true, configured: true, throws: false }));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => {
    if (config.throws) throw new Error("configuration fixture failure");
    return config.configured ? { idp: { enabled: config.enabled } } : null;
  },
  idpBaseUrl: () => "https://idp.test",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: (_action: unknown, initial: unknown) => [initial, () => {}, false],
}));

beforeEach(() => {
  config.enabled = config.configured = true;
  config.throws = false;
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unconfigured test request")));
});
afterEach(() => vi.unstubAllGlobals());

async function page(token: string | string[] | undefined = "claim-fixture") {
  return renderToStaticMarkup(await ClaimPage({ searchParams: Promise.resolve({ token }) }));
}

function invalid(html: string) {
  expect(html).toContain("Link invalid or expired");
  expect(html).toContain(
    "This setup link is invalid, has already been used, or has expired. One-time links are valid for 48 hours."
  );
  expect(html).toMatch(/contact your administrator and ask them to generate a new\s+setup link/);
  expect(html).toContain('href="/login"');
  expect(html).not.toContain("<form");
  expect(html).not.toContain("Account created");
  expect(html).not.toContain("email_exists");
  expect(html).not.toContain("held by another tenant");
}

describe("V0: missing query", () => {
  it.each([
    { label: "missing", token: undefined },
    { label: "empty", token: "" },
    { label: "whitespace", token: " \t " },
    { label: "array", token: ["claim-fixture"] },
  ])("$label never validates", async ({ token }) => {
    // Pass undefined directly; page()'s default is intentionally not used here.
    const html = renderToStaticMarkup(
      await ClaimPage({ searchParams: Promise.resolve({ token }) })
    );
    expect(html).toContain("No setup link provided");
    expect(html).toContain("This page requires a one-time setup link.");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("<form");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("V1/V3: all validation failures share the neutral screen", () => {
  it.each([
    {
      label: "semantic false",
      status: 200,
      body: { valid: false, reason: "email_exists", message: "held by another tenant" },
    },
    ...[400, 401, 403, 404, 409, 429, 500, 503].map((status) => ({
      label: `HTTP ${status}`,
      status,
      body: { valid: true, error: "email_exists", message: "held by another tenant" },
    })),
    { label: "null JSON", status: 200, body: null },
    { label: "missing valid", status: 200, body: {} },
  ])("$label", async ({ status, body }) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    invalid(await page());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "invalid JSON"])("%s", async (fault) => {
    const fetchMock = vi.fn();
    if (fault === "network") fetchMock.mockRejectedValueOnce(new Error("email_exists"));
    else fetchMock.mockResolvedValueOnce(new Response("not JSON"));
    vi.stubGlobal("fetch", fetchMock);
    invalid(await page());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["disabled", "unconfigured"])("%s makes no request", async (kind) => {
    if (kind === "disabled") config.enabled = false;
    else config.configured = false;
    invalid(await page());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("configuration-loader exceptions currently escape before the fetch try", async () => {
    config.throws = true;
    await expect(page()).rejects.toThrow("configuration fixture failure");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("V2: capability metadata, not an account lookup", () => {
  it.each([
    { label: "bound", target_email: "recipient@example.test", bound: true },
    { label: "unbound", target_email: undefined, bound: false },
    { label: "empty target", target_email: "", bound: false },
  ])("$label email", async ({ target_email, bound }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ valid: true, organization_name: "Claim organization", target_email })
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const html = await page("  claim-fixture  ");
    expect(html).toContain("Set up your account");
    expect(html).toContain("Claim organization");
    const input = html.match(/<input[^>]*id="claim-email"[^>]*>/)?.[0] ?? "";
    expect(input.length).toBeGreaterThan(0);
    expect(input.includes("readOnly")).toBe(bound);
    expect(input.includes("required")).toBe(!bound);
    if (bound) {
      expect(input).toContain('value="recipient@example.test"');
      expect(html).toContain("This email is bound to your setup link and cannot be changed.");
    } else expect(html).toContain("Enter the email address for the organization admin account.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("token") === "claim-fixture").toBe(
      true
    );
  });

  it("keeps the current Boolean coercion and drops non-string metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ valid: "false", organization_name: 1, target_email: false })
          )
        )
    );
    expect(await validateClaimToken("claim-fixture")).toEqual({
      valid: true,
      organizationName: undefined,
      targetEmail: undefined,
    });
  });
});
