import { describe, expect, it } from "vitest";
import {
  agBaseUrl,
  agIdentityBaseUrl,
  agIdentityPublicUrl,
  idpBaseUrl,
  runtimeMode,
  toPublicConfig,
} from "../lib/runtime-config";
import type { RuntimeConfig } from "../lib/types";

function baseConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    configured: true,
    ui_origin: "http://localhost:7114",
    idp: { enabled: true, public_base_url: "http://localhost:7113" },
    ag: { enabled: true, public_base_url: "http://localhost:7215" },
    ...overrides,
  };
}

// ── agBaseUrl ────────────────────────────────────────────────────────────────

describe("agBaseUrl", () => {
  it("returns internal_base_url when present (highest priority)", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "http://identuum-ag:7215",
        management_base_url: "http://mgmt:7215",
      },
    });
    expect(agBaseUrl(cfg)).toBe("http://identuum-ag:7215");
  });

  it("falls back to management_base_url when internal_base_url is absent (legacy compat)", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        management_base_url: "http://host.docker.internal:7215",
      },
    });
    expect(agBaseUrl(cfg)).toBe("http://host.docker.internal:7215");
  });

  it("falls back to public_base_url when no server-side URL is set", () => {
    const cfg = baseConfig({
      ag: { enabled: true, public_base_url: "http://localhost:7215" },
    });
    expect(agBaseUrl(cfg)).toBe("http://localhost:7215");
  });

  it("trims whitespace from internal_base_url", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "  http://identuum-ag:7215  ",
      },
    });
    expect(agBaseUrl(cfg)).toBe("http://identuum-ag:7215");
  });

  it("skips blank internal_base_url and falls back to management_base_url", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "   ",
        management_base_url: "http://host.docker.internal:7215",
      },
    });
    expect(agBaseUrl(cfg)).toBe("http://host.docker.internal:7215");
  });

  it("skips blank management_base_url and falls back to public_base_url", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        management_base_url: "  ",
      },
    });
    expect(agBaseUrl(cfg)).toBe("http://localhost:7215");
  });
});

// ── toPublicConfig does not expose server-side URLs ───────────────────────────

describe("toPublicConfig", () => {
  it("strips internal_base_url from AG config", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "http://identuum-ag:7215",
      },
    });
    const pub = toPublicConfig(cfg);
    expect(JSON.stringify(pub)).not.toContain("identuum-ag");
    expect(JSON.stringify(pub)).not.toContain("internal_base_url");
    expect(pub.ag.public_base_url).toBe("http://localhost:7215");
  });

  it("strips management_base_url from AG config (no legacy field in public output)", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        management_base_url: "http://host.docker.internal:7215",
      },
    });
    const pub = toPublicConfig(cfg);
    expect(JSON.stringify(pub)).not.toContain("host.docker.internal");
    expect(JSON.stringify(pub)).not.toContain("management_base_url");
  });

  it("strips IDP internal_base_url", () => {
    const cfg = baseConfig({
      idp: {
        enabled: true,
        public_base_url: "http://localhost:7113",
        internal_base_url: "http://identuum-idp:7113",
      },
    });
    const pub = toPublicConfig(cfg);
    expect(JSON.stringify(pub)).not.toContain("identuum-idp");
    expect(JSON.stringify(pub)).not.toContain("internal_base_url");
    expect(pub.idp.public_base_url).toBe("http://localhost:7113");
  });
});

// ── runtimeMode ──────────────────────────────────────────────────────────────

describe("runtimeMode", () => {
  it("returns hybrid when both IDP and AG are enabled", () => {
    expect(runtimeMode(baseConfig())).toBe("hybrid");
  });

  it("returns auth-service when only IDP is enabled", () => {
    const cfg = baseConfig({
      ag: { enabled: false, public_base_url: "" },
    });
    expect(runtimeMode(cfg)).toBe("auth-service");
  });

  it("returns governor-only when only AG is enabled", () => {
    const cfg = baseConfig({
      idp: { enabled: false, public_base_url: "" },
    });
    expect(runtimeMode(cfg)).toBe("governor-only");
  });

  it("returns unconfigured for null", () => {
    expect(runtimeMode(null)).toBe("unconfigured");
  });

  it("returns unconfigured when configured=false", () => {
    expect(runtimeMode({ ...baseConfig(), configured: false })).toBe("unconfigured");
  });
});

// ── idpBaseUrl ────────────────────────────────────────────────────────────────

describe("idpBaseUrl", () => {
  it("returns internal_base_url when present", () => {
    const cfg = baseConfig({
      idp: {
        enabled: true,
        public_base_url: "http://localhost:7113",
        internal_base_url: "http://identuum-idp:7113",
      },
    });
    expect(idpBaseUrl(cfg)).toBe("http://identuum-idp:7113");
  });

  it("falls back to public_base_url when internal_base_url is absent", () => {
    expect(idpBaseUrl(baseConfig())).toBe("http://localhost:7113");
  });
});

// ── agIdentityBaseUrl / agIdentityPublicUrl ───────────────────────────────────

describe("agIdentityBaseUrl", () => {
  it("returns identity_internal_base_url when set", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "http://identuum-ag:7215",
        identity_base_url: "http://localhost:7214",
        identity_internal_base_url: "http://identuum-ag:7214",
      },
    });
    expect(agIdentityBaseUrl(cfg)).toBe("http://identuum-ag:7214");
  });

  it("falls back to identity_base_url when identity_internal_base_url absent", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        identity_base_url: "http://localhost:7214",
      },
    });
    expect(agIdentityBaseUrl(cfg)).toBe("http://localhost:7214");
  });

  it("falls back to agBaseUrl when identity fields absent", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        internal_base_url: "http://identuum-ag:7215",
      },
    });
    expect(agIdentityBaseUrl(cfg)).toBe("http://identuum-ag:7215");
  });
});

describe("agIdentityPublicUrl", () => {
  it("returns identity_base_url when set", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        identity_base_url: "http://localhost:7214",
        identity_internal_base_url: "http://identuum-ag:7214",
      },
    });
    expect(agIdentityPublicUrl(cfg)).toBe("http://localhost:7214");
  });

  it("does not return identity_internal_base_url (browser-facing only)", () => {
    const cfg = baseConfig({
      ag: {
        enabled: true,
        public_base_url: "http://localhost:7215",
        identity_base_url: "http://localhost:7214",
        identity_internal_base_url: "http://identuum-ag:7214",
      },
    });
    expect(agIdentityPublicUrl(cfg)).not.toContain("identuum-ag");
  });

  it("falls back to public_base_url when identity_base_url absent", () => {
    expect(agIdentityPublicUrl(baseConfig())).toBe("http://localhost:7215");
  });
});
