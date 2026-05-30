import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAgAuthProviders,
  isRelativeLoginUrl,
  isValidProviderSlug,
  sanitiseProvider,
} from "../lib/ag-auth-providers";

// ---------------------------------------------------------------------------
// isRelativeLoginUrl
// ---------------------------------------------------------------------------

describe("isRelativeLoginUrl", () => {
  it("accepts relative paths starting with /", () => {
    expect(isRelativeLoginUrl("/login?idp=entra-prod")).toBe(true);
    expect(isRelativeLoginUrl("/login")).toBe(true);
  });

  it("rejects absolute URLs with protocol", () => {
    expect(isRelativeLoginUrl("https://ag.example.com/login?idp=entra")).toBe(false);
    expect(isRelativeLoginUrl("http://internal:7214/login?idp=test")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isRelativeLoginUrl("")).toBe(false);
  });

  it("rejects paths not starting with /", () => {
    expect(isRelativeLoginUrl("login?idp=entra")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidProviderSlug
// ---------------------------------------------------------------------------

describe("isValidProviderSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidProviderSlug("entra-prod")).toBe(true);
    expect(isValidProviderSlug("okta")).toBe(true);
    expect(isValidProviderSlug("my-idp-1")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidProviderSlug("")).toBe(false);
  });

  it("rejects slugs with uppercase", () => {
    expect(isValidProviderSlug("Entra")).toBe(false);
  });

  it("rejects slugs with special characters", () => {
    expect(isValidProviderSlug("entra_prod")).toBe(false);
    expect(isValidProviderSlug("entra prod")).toBe(false);
    expect(isValidProviderSlug("<script>")).toBe(false);
  });

  it("rejects overly long slugs (>64 chars)", () => {
    expect(isValidProviderSlug("a".repeat(65))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitiseProvider
// ---------------------------------------------------------------------------

describe("sanitiseProvider", () => {
  const valid = {
    id: "entra-prod",
    type: "microsoft_entra",
    display_name: "Microsoft Entra",
    login_url: "/login?idp=entra-prod",
    enabled: true,
    advanced: false,
  };

  it("accepts a valid provider", () => {
    const result = sanitiseProvider(valid);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("entra-prod");
    expect(result?.display_name).toBe("Microsoft Entra");
  });

  it("rejects provider with absolute login_url", () => {
    expect(
      sanitiseProvider({ ...valid, login_url: "https://ag.example.com/login?idp=entra-prod" })
    ).toBeNull();
  });

  it("rejects provider with invalid id/slug", () => {
    expect(sanitiseProvider({ ...valid, id: "Entra_PROD" })).toBeNull();
    expect(sanitiseProvider({ ...valid, id: "" })).toBeNull();
  });

  it("rejects provider missing display_name", () => {
    expect(sanitiseProvider({ ...valid, display_name: "" })).toBeNull();
  });

  it("rejects null and non-object input", () => {
    expect(sanitiseProvider(null)).toBeNull();
    expect(sanitiseProvider("string")).toBeNull();
    expect(sanitiseProvider([valid])).toBeNull();
  });

  it("does not include client_secret or issuer_url in output", () => {
    const withSecrets = {
      ...valid,
      client_secret: "super-secret",
      client_id: "app-id",
      issuer_url: "https://login.microsoftonline.com/tenant",
    };
    const result = sanitiseProvider(withSecrets);
    expect(result).not.toBeNull();
    const json = JSON.stringify(result);
    expect(json).not.toContain("client_secret");
    expect(json).not.toContain("client_id");
    expect(json).not.toContain("issuer_url");
  });
});

// ---------------------------------------------------------------------------
// fetchAgAuthProviders
// ---------------------------------------------------------------------------

describe("fetchAgAuthProviders", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns not-available when agManagementBaseUrl is null", async () => {
    const state = await fetchAgAuthProviders(null);
    expect(state.available).toBe(false);
    expect(state.providers).toEqual([]);
    expect(state.error_code).toBeNull();
  });

  it("returns available with providers on 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "entra-prod",
              type: "microsoft_entra",
              display_name: "Microsoft Entra",
              login_url: "/login?idp=entra-prod",
              enabled: true,
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(true);
    expect(state.auth_mode).toBe("external_oidc");
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0].display_name).toBe("Microsoft Entra");
    // Login choices come from backend metadata, not hardcoded
    expect(state.providers[0].id).toBe("entra-prod");
    expect(state.provider_count).toBe(1);
    expect(state.error_code).toBeNull();
  });

  it("returns empty providers when response providers array is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(true);
    expect(state.providers).toEqual([]);
    expect(state.provider_count).toBe(0);
    expect(state.error_code).toBeNull();
  });

  it("returns error_code=provider_discovery_failed on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          providers: [],
          error: { code: "provider_discovery_failed" },
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.error_code).toBe("provider_discovery_failed");
    expect(state.providers).toEqual([]);
  });

  it("returns error_code=unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.error_code).toBe("unreachable");
    expect(state.providers).toEqual([]);
  });

  it("returns error_code=wrong_component when component field does not match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-idp",
          auth_mode: "local",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.error_code).toBe("wrong_component");
  });

  it("returns error_code=invalid_json when response is not a JSON object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => "not-an-object",
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.error_code).toBe("invalid_json");
  });

  it("rejects providers with absolute login_url from response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "bad-idp",
              type: "generic_oidc",
              display_name: "Bad IDP",
              login_url: "https://external.example.com/login",
              enabled: true,
              advanced: true,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(true);
    // Provider with absolute login_url must be rejected
    expect(state.providers).toHaveLength(0);
    expect(state.provider_count).toBe(0);
  });

  it("preserves disabled providers with enabled=false in state (not filtered out)", async () => {
    // Disabled providers are now included so the UI can show them as locked.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: false,
          unavailable_reason: "forbidden_feature",
          providers: [
            {
              id: "active-idp",
              type: "generic_oidc",
              display_name: "Active IDP",
              login_url: "/login?idp=active-idp",
              enabled: false,
              advanced: false,
              unavailable_reason: "forbidden_feature",
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    // Disabled providers are kept — not filtered out.
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0].enabled).toBe(false);
    expect(state.providers[0].unavailable_reason).toBe("forbidden_feature");
    expect(state.provider_count).toBe(1);
  });

  it("does not include internal AG backend URL in returned state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: true,
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag-internal:7215");
    const json = JSON.stringify(state);
    // Internal base URL must not appear in the returned state
    expect(json).not.toContain("ag-internal");
    expect(json).not.toContain("7215");
  });

  it("generic_oidc provider is marked advanced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "custom-oidc",
              type: "generic_oidc",
              display_name: "Custom OIDC",
              login_url: "/login?idp=custom-oidc",
              enabled: true,
              advanced: true,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.providers[0].advanced).toBe(true);
  });

  it("does not leak secret-like fields from AG response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: true,
              advanced: false,
              client_secret: "leaked-secret",
              client_id: "app-id",
              issuer_url: "https://login.microsoftonline.com/tenant",
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    const json = JSON.stringify(state);
    expect(json).not.toContain("client_secret");
    expect(json).not.toContain("client_id");
    expect(json).not.toContain("issuer_url");
  });

  it("uses the correct discovery endpoint path", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ component: "identuum-ag", auth_mode: "unknown", providers: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAgAuthProviders("http://ag:7215");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://ag:7215/api/v1/auth/providers");
  });

  it("strips trailing slash from base URL before appending path", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ component: "identuum-ag", auth_mode: "unknown", providers: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAgAuthProviders("http://ag:7215/");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://ag:7215/api/v1/auth/providers");
  });
});

// ---------------------------------------------------------------------------
// Platform status — safe error code reporting
// ---------------------------------------------------------------------------

describe("platform status: auth provider discovery state shape", () => {
  it("discovery state does not contain secret-like fields", () => {
    const state = {
      available: true,
      auth_mode: "external_oidc",
      login_available: true,
      unavailable_reason: null,
      providers: [
        {
          id: "entra",
          type: "microsoft_entra",
          display_name: "Entra",
          login_url: "/login?idp=entra",
          enabled: true,
          advanced: false,
        },
      ],
      provider_count: 1,
      error_code: null,
    };
    const json = JSON.stringify(state);
    const forbidden = ["password", "private_key", "secret", "token", "issuer_url", "client_id"];
    for (const f of forbidden) {
      expect(json, `field "${f}" must not appear in discovery state`).not.toContain(f);
    }
  });

  it("error state uses safe error code, not raw backend error text", () => {
    const state = {
      available: false,
      auth_mode: "unknown",
      login_available: false,
      unavailable_reason: null,
      providers: [],
      provider_count: 0,
      error_code: "provider_discovery_failed",
    };
    expect(state.error_code).toBe("provider_discovery_failed");
    expect(JSON.stringify(state)).not.toContain("stack");
    expect(JSON.stringify(state)).not.toContain("sql");
  });

  it("forbidden_feature state shows provider count and safe reason", () => {
    const state = {
      available: true,
      auth_mode: "external_oidc",
      login_available: false,
      unavailable_reason: "forbidden_feature",
      providers: [
        {
          id: "entra",
          type: "microsoft_entra",
          display_name: "Entra",
          login_url: "/login?idp=entra",
          enabled: false,
          advanced: false,
          unavailable_reason: "forbidden_feature",
        },
      ],
      provider_count: 1,
      error_code: null,
    };
    expect(state.login_available).toBe(false);
    expect(state.unavailable_reason).toBe("forbidden_feature");
    expect(state.provider_count).toBe(1);
    // Safe: no internal detail leaked
    expect(JSON.stringify(state)).not.toContain("sql");
    expect(JSON.stringify(state)).not.toContain("stack");
    expect(JSON.stringify(state)).not.toContain("internal");
  });
});

// ---------------------------------------------------------------------------
// License-awareness: login_available and unavailable_reason
// ---------------------------------------------------------------------------

describe("fetchAgAuthProviders — license availability", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves login_available=true when OIDCFederation is licensed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: true,
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Microsoft Entra",
              login_url: "/login?idp=entra",
              enabled: true,
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.login_available).toBe(true);
    expect(state.unavailable_reason).toBeNull();
    expect(state.providers[0].enabled).toBe(true);
    // No unavailable_reason on enabled provider
    expect(state.providers[0].unavailable_reason).toBeUndefined();
  });

  it("preserves login_available=false + forbidden_feature when OIDCFederation not licensed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: false,
          unavailable_reason: "forbidden_feature",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Microsoft Entra",
              login_url: "/login?idp=entra",
              enabled: false,
              advanced: false,
              unavailable_reason: "forbidden_feature",
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.login_available).toBe(false);
    expect(state.unavailable_reason).toBe("forbidden_feature");
    // Provider is disabled and has reason
    expect(state.providers[0].enabled).toBe(false);
    expect(state.providers[0].unavailable_reason).toBe("forbidden_feature");
    // Provider is still included in state — not filtered out
    expect(state.provider_count).toBe(1);
  });

  it("sets login_available=null when absent from AG response (no providers case)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          providers: [],
          // No login_available field
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.login_available).toBeNull();
    expect(state.unavailable_reason).toBeNull();
    // No providers — does not show forbidden_feature
    expect(state.provider_count).toBe(0);
  });

  it("sets login_available=false on 503 provider_discovery_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          login_available: false,
          providers: [],
          error: { code: "provider_discovery_failed" },
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.login_available).toBe(false);
    expect(state.error_code).toBe("provider_discovery_failed");
  });

  it("does not show forbidden_feature for empty provider list (no providers configured)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.login_available).toBeNull();
    expect(state.unavailable_reason).toBeNull();
    // No providers — unavailable_reason must not be set to forbidden_feature
    expect(state.provider_count).toBe(0);
  });

  it("absolute login_url remains rejected even when provider is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: false,
          unavailable_reason: "forbidden_feature",
          providers: [
            {
              id: "bad",
              type: "generic_oidc",
              display_name: "Bad",
              login_url: "https://attacker.example.com/login",
              enabled: false,
              advanced: true,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    // Provider with absolute login_url must be rejected regardless of enabled flag
    expect(state.providers).toHaveLength(0);
    expect(state.provider_count).toBe(0);
  });

  it("internal AG backend URL is not present in discovery state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: false,
          unavailable_reason: "forbidden_feature",
          providers: [
            {
              id: "entra",
              type: "generic_oidc",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: false,
              unavailable_reason: "forbidden_feature",
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag-internal:7215");
    const json = JSON.stringify(state);
    expect(json).not.toContain("ag-internal");
    expect(json).not.toContain("7215");
  });

  it("secret-like fields from AG response are not included in state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          login_available: false,
          unavailable_reason: "forbidden_feature",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: false,
              advanced: false,
              unavailable_reason: "forbidden_feature",
              client_secret: "DO-NOT-EXPOSE",
              client_id: "sensitive-id",
              issuer_url: "https://internal/tenant",
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    const json = JSON.stringify(state);
    expect(json).not.toContain("DO-NOT-EXPOSE");
    expect(json).not.toContain("client_secret");
    expect(json).not.toContain("client_id");
    expect(json).not.toContain("issuer_url");
  });
});

// ---------------------------------------------------------------------------
// Local-login signal (local_login_available + local_login_url)
// ---------------------------------------------------------------------------
//
// AG started emitting these two fields on 2026-05-25 to advertise local
// site-admin password login (POST /login on the identity surface). The UI
// uses local_login_available to decide whether to show the password form or
// a "setup required" hint, and treats absent (older AG builds) as null so
// the form continues to render defensively.

describe("fetchAgAuthProviders — local login signal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("propagates local_login_available=true and local_login_url='/login'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "local",
          local_login_available: true,
          local_login_url: "/login",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(true);
    expect(state.auth_mode).toBe("local");
    expect(state.local_login_available).toBe(true);
    expect(state.local_login_url).toBe("/login");
  });

  it("propagates local_login_available=false and drops local_login_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          local_login_available: false,
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.local_login_available).toBe(false);
    expect(state.local_login_url).toBeNull();
  });

  it("returns local_login_*=null when AG omits the fields (older build compat)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "external_oidc",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: true,
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.local_login_available).toBeNull();
    expect(state.local_login_url).toBeNull();
  });

  it("rejects absolute local_login_url (open-redirect guard)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "local",
          local_login_available: true,
          // Absolute URL — must be rejected, not propagated to the UI.
          local_login_url: "https://attacker.example.com/login",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    // The signal stays truthy because AG advertised availability, but the URL
    // is discarded so the UI does not pass an attacker-controlled value to the
    // client.
    expect(state.local_login_available).toBe(true);
    expect(state.local_login_url).toBeNull();
  });

  it("does not propagate local_login_url when local_login_available=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          local_login_available: false,
          // AG should not send a URL with available=false, but defensively
          // the UI ignores it anyway.
          local_login_url: "/login",
          providers: [],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.local_login_available).toBe(false);
    expect(state.local_login_url).toBeNull();
  });

  it("503 path leaves local_login_*=null (AG did not successfully list providers)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "unknown",
          providers: [],
          error: { code: "provider_discovery_failed" },
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.available).toBe(false);
    expect(state.local_login_available).toBeNull();
    expect(state.local_login_url).toBeNull();
  });

  it("local + federated together — both signals coexist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          component: "identuum-ag",
          auth_mode: "mixed",
          login_available: true,
          local_login_available: true,
          local_login_url: "/login",
          providers: [
            {
              id: "entra",
              type: "microsoft_entra",
              display_name: "Entra",
              login_url: "/login?idp=entra",
              enabled: true,
              advanced: false,
            },
          ],
        }),
      })
    );

    const state = await fetchAgAuthProviders("http://ag:7215");
    expect(state.auth_mode).toBe("mixed");
    expect(state.login_available).toBe(true);
    expect(state.local_login_available).toBe(true);
    expect(state.local_login_url).toBe("/login");
    expect(state.providers).toHaveLength(1);
  });
});
