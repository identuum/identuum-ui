/**
 * Tests for slice identuum-20260530-site-admin-observability-pages.
 *
 * Six new read-only site-admin pages + their wire helpers. All
 * helpers and pages must project EXPLICITLY to safe non-secret
 * fields; this file pins the no-secret / no-env-var / no-DB-URL /
 * no-mutation-control / no-console invariants at the source-text
 * level so a future regression that started populating a sensitive
 * field server-side cannot leak through the UI by accident.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WIRE_SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

const NAV_SRC = readFileSync(
  resolve(__dirname, "..", "components", "site-admin", "site-admin-nav.tsx"),
  "utf-8"
);

const FEATURE_BOUNDARY_PANEL_SRC = readFileSync(
  resolve(__dirname, "..", "components", "shared", "feature-boundary-panel.tsx"),
  "utf-8"
);

const CAPABILITY_AFFORDANCE_SRC = readFileSync(
  resolve(__dirname, "..", "lib", "capability-affordances.ts"),
  "utf-8"
);

// ── Sidebar navigation ──────────────────────────────────────────────────────

describe("SiteAdminNav — sidebar adds entries for the 6 new pages", () => {
  it("declares Signing keys / Anomaly / Reports / System entries pointing at the right hrefs", () => {
    expect(NAV_SRC).toMatch(/label:\s*"Signing keys",\s*href:\s*"\/site-admin\/keys"/);
    expect(NAV_SRC).toMatch(/label:\s*"Anomaly",\s*href:\s*"\/site-admin\/anomaly"/);
    expect(NAV_SRC).toMatch(/label:\s*"Reports",\s*href:\s*"\/site-admin\/reports"/);
    expect(NAV_SRC).toMatch(/label:\s*"System",\s*href:\s*"\/site-admin\/system"/);
  });

  it("marks CE-only observability nav links with Enterprise/CE copy while preserving hrefs", () => {
    for (const [label, capability] of [
      ["Audit", "audit_log"],
      ["Anomaly", "anomaly_detection"],
      ["Reports", "reporting"],
    ] as const) {
      const item = NAV_SRC.match(new RegExp(`label:\\s*"${label}"[\\s\\S]*?\\}`))?.[0] ?? "";
      expect(item).toContain(`capability: "${capability}"`);
      expect(item).toContain('boundary: "enterprise_ce"');
    }
    expect(CAPABILITY_AFFORDANCE_SRC).toContain("Enterprise/CE");
    const signingKeysItem = NAV_SRC.match(/\{\s*label:\s*"Signing keys"[^}]*\}/)?.[0] ?? "";
    const systemItem = NAV_SRC.match(/\{\s*label:\s*"System"[^}]*\}/)?.[0] ?? "";
    expect(signingKeysItem).not.toContain("enterprise_ce");
    expect(systemItem).not.toContain("enterprise_ce");
  });

  it("preserves the pre-existing Overview / Organizations / Audit / Settings entries", () => {
    expect(NAV_SRC).toMatch(/label:\s*"Overview",\s*href:\s*"\/site-admin"/);
    expect(NAV_SRC).toMatch(/label:\s*"Organizations"/);
    expect(NAV_SRC).toMatch(/label:\s*"Audit"/);
    expect(NAV_SRC).toMatch(/label:\s*"Settings"/);
  });

  it("DISABLED_LABELS is now an empty literal — the placeholder System Status was promoted to a real entry", () => {
    expect(NAV_SRC).toMatch(/const\s+DISABLED_LABELS:\s*string\[\]\s*=\s*\[\s*\]\s*;/);
  });
});

// ── Shared feature-boundary panel ───────────────────────────────────────────

describe("FeatureBoundaryPanel — reusable direct-access boundary copy", () => {
  it("exists as a small shared component with neutral/warning/error tones", () => {
    expect(FEATURE_BOUNDARY_PANEL_SRC).toContain("export function FeatureBoundaryPanel");
    expect(FEATURE_BOUNDARY_PANEL_SRC).toContain('tone?: "neutral" | "warning" | "error"');
  });
});

// ── Wire helpers — generic invariants across all six ────────────────────────

const HELPER_NAMES = [
  "listSigningKeys",
  "listAnomalyEvents",
  "getAnomalyStats",
  "listAdminSessions",
  "verifyAuditChain",
  "getSystemInfo",
] as const;

function isolateHelperBody(name: string): string {
  const start = WIRE_SRC.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const tail = WIRE_SRC.slice(start);
  const end = tail.indexOf("\nexport ", 1);
  return end >= 0 ? tail.slice(0, end) : tail;
}

describe("Six wire helpers — generic safe-projection invariants", () => {
  for (const name of HELPER_NAMES) {
    it(`${name} is declared and uses GET (no POST/PUT/PATCH/DELETE)`, () => {
      expect(WIRE_SRC).toMatch(new RegExp(`export async function ${name}\\b`));
      const body = isolateHelperBody(name);
      expect(body).toMatch(/method:\s*"GET"/);
      expect(body).not.toMatch(/method:\s*"POST"/);
      expect(body).not.toMatch(/method:\s*"PUT"/);
      expect(body).not.toMatch(/method:\s*"PATCH"/);
      expect(body).not.toMatch(/method:\s*"DELETE"/);
    });

    it(`${name} sends NO request body — these are read-only endpoints`, () => {
      const body = isolateHelperBody(name);
      // The fetch init MUST NOT carry a `body:` field. `headers:`
      // is fine (session cookie). `Content-Type` MUST be absent.
      const initMatch = body.match(/method:\s*"GET"[\s\S]*?\}\s*\n?\s*\)/);
      expect(initMatch).not.toBeNull();
      const initBlock = initMatch?.[0] ?? "";
      expect(initBlock).not.toMatch(/\bbody:/);
      expect(initBlock).not.toMatch(/"Content-Type"/);
    });

    it(`${name} body has NO console.* call`, () => {
      const body = isolateHelperBody(name);
      expect(body).not.toMatch(/console\.\w+/);
    });

    it(`${name} body does NOT read any secret-shaped field from the response`, () => {
      const body = isolateHelperBody(name);
      // Strip line comments so doc-block prose mentioning forbidden
      // fields (as documented exclusions) does not trip the
      // assertion. Real code accessing the field would survive the
      // strip.
      const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const BANNED: RegExp[] = [
        /\bclient_secret\b/,
        /\bclient_secret_hash\b/,
        /\bsecret_hash\b/,
        /\bprivate_key\b/,
        /\bpem\b/,
        /\bseed\b/,
        /\bbearer\b/i,
        /\baccess_token\b/,
        /\brefresh_token\b/,
        /\bauthorization_code\b/,
        /\bdatabase_url\b/i,
        /\bdb_url\b/i,
        /\bredis_url\b/i,
        /\benv_var\b/i,
        /\bpassword_hash\b/,
        /\bsession_token\b/,
        /\bSet-Cookie\b/i,
      ];
      for (const pat of BANNED) {
        expect(stripped, `${name} body must not reference ${pat}`).not.toMatch(pat);
      }
    });
  }
});

// ── listSigningKeys: explicit field allowlist on the projection ─────────────

describe("listSigningKeys — wire contract + safe projection", () => {
  it("GETs /api/v1/keys", () => {
    const body = isolateHelperBody("listSigningKeys");
    expect(body).toMatch(/\/api\/v1\/keys/);
  });

  it("projects ONLY the documented safe fields (kid/algorithm/state/created_at/activated_at/rotated_at/expires_at/public_key) and NEVER reads private material", () => {
    const body = isolateHelperBody("listSigningKeys");
    // Allowed reads.
    expect(body).toMatch(/k\.kid/);
    expect(body).toMatch(/k\.algorithm/);
    expect(body).toMatch(/k\.state/);
    expect(body).toMatch(/k\.created_at/);
    expect(body).toMatch(/k\.activated_at/);
    expect(body).toMatch(/k\.rotated_at/);
    expect(body).toMatch(/k\.expires_at/);
    expect(body).toMatch(/k\.public_key/);
    // Forbidden reads — inline JWKS-private components.
    const BANNED: RegExp[] = [
      /k\.d\b/,
      /k\.p\b/,
      /k\.q\b/,
      /k\.dp\b/,
      /k\.dq\b/,
      /k\.qi\b/,
      /k\.k\b/,
      /k\.private_key/,
      /k\.private_pem/,
      /k\.seed/,
      /k\.jwks_private/,
    ];
    for (const pat of BANNED) {
      expect(body, `listSigningKeys must not read ${pat}`).not.toMatch(pat);
    }
  });
});

// ── listAnomalyEvents: explicit projection, drops metadata map ──────────────

describe("listAnomalyEvents — wire contract + safe projection", () => {
  it("GETs /api/v1/anomaly/events", () => {
    const body = isolateHelperBody("listAnomalyEvents");
    expect(body).toMatch(/\/api\/v1\/anomaly\/events/);
  });

  it("projects ONLY id/organization_id/score/detection_method/created_at and DROPS the metadata map", () => {
    const body = isolateHelperBody("listAnomalyEvents");
    expect(body).toMatch(/a\.id/);
    expect(body).toMatch(/a\.organization_id/);
    expect(body).toMatch(/a\.score/);
    expect(body).toMatch(/a\.detection_method/);
    expect(body).toMatch(/a\.created_at/);
    // The IDP returns a `metadata` map that MAY carry sensitive
    // detection-specific data — the projection must NEVER read it.
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/a\.metadata/);
  });

  it("routes absent/license-gated responses through the shared IDP status classifier", () => {
    const body = isolateHelperBody("listAnomalyEvents");
    expect(body).toContain("classifyAdminReadFailure(res)");
  });
});

// ── getAnomalyStats: shape pin ──────────────────────────────────────────────

describe("getAnomalyStats — wire contract + safe projection", () => {
  it("GETs /api/v1/anomaly/stats and projects only the three counter fields", () => {
    const body = isolateHelperBody("getAnomalyStats");
    expect(body).toMatch(/\/api\/v1\/anomaly\/stats/);
    expect(body).toMatch(/total_anomalies/);
    expect(body).toMatch(/recent_24h/);
    expect(body).toMatch(/high_risk_24h/);
  });

  it("routes absent/license-gated responses through the shared IDP status classifier", () => {
    const body = isolateHelperBody("getAnomalyStats");
    expect(body).toContain("classifyAdminReadFailure(res)");
  });
});

// ── listAdminSessions: NEVER reads a token field ────────────────────────────

describe("listAdminSessions — wire contract + no-session-material projection", () => {
  it("GETs /api/v1/system/sessions", () => {
    const body = isolateHelperBody("listAdminSessions");
    expect(body).toMatch(/\/api\/v1\/system\/sessions/);
  });

  it("projects only id/created_at/expires_at/last_used_at/is_active/is_current — NEVER reads token / cookie / selector / validator", () => {
    const body = isolateHelperBody("listAdminSessions");
    expect(body).toMatch(/s\.id/);
    expect(body).toMatch(/s\.created_at/);
    expect(body).toMatch(/s\.expires_at/);
    expect(body).toMatch(/s\.last_used_at/);
    expect(body).toMatch(/s\.is_active/);
    expect(body).toMatch(/s\.is_current/);
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const BANNED: RegExp[] = [
      /s\.token\b/,
      /s\.cookie\b/,
      /s\.selector\b/,
      /s\.validator\b/,
      /s\.refresh_token/,
      /s\.access_token/,
      /s\.session_token/,
    ];
    for (const pat of BANNED) {
      expect(stripped, `listAdminSessions must not read ${pat}`).not.toMatch(pat);
    }
  });
});

// ── verifyAuditChain: drops head_hash + head_signature hex strings ──────────

describe("verifyAuditChain — wire contract + safe projection", () => {
  it("GETs /api/v1/system/audit/chain/verify", () => {
    const body = isolateHelperBody("verifyAuditChain");
    expect(body).toMatch(/\/api\/v1\/system\/audit\/chain\/verify/);
  });

  it("routes absent/license-gated responses through the shared IDP status classifier", () => {
    const body = isolateHelperBody("verifyAuditChain");
    expect(body).toContain("classifyAdminReadFailure(res)");
    expect(body).not.toMatch(/res\.status\s*===\s*403[\s\S]*?forbidden:\s*true/);
  });

  it("projects ONLY count fields + per-shard organization_id/status/rows_verified/head_signature_status — DROPS head_hash and head_signature", () => {
    const body = isolateHelperBody("verifyAuditChain");
    expect(body).toMatch(/shard_count/);
    expect(body).toMatch(/ok_count/);
    expect(body).toMatch(/diverged_count/);
    expect(body).toMatch(/empty_count/);
    expect(body).toMatch(/signed_count/);
    expect(body).toMatch(/unsigned_count/);
    expect(body).toMatch(/signature_invalid_count/);
    expect(body).toMatch(/uncheckable_count/);
    expect(body).toMatch(/s\.organization_id/);
    expect(body).toMatch(/s\.status/);
    expect(body).toMatch(/s\.rows_verified/);
    expect(body).toMatch(/s\.head_signature_status/);
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/s\.head_hash/);
    expect(stripped).not.toMatch(/s\.head_signature\b/);
    expect(stripped).not.toMatch(/s\.head_signed_kid/);
    expect(stripped).not.toMatch(/s\.head_signed_at/);
  });
});

// ── getSystemInfo: NEVER reads DB URLs / Redis URLs / env vars / credentials ──

describe("getSystemInfo — wire contract + safe projection", () => {
  it("GETs /api/v1/health/details", () => {
    const body = isolateHelperBody("getSystemInfo");
    expect(body).toMatch(/\/api\/v1\/health\/details/);
  });

  it("projects ONLY status/version/database.status/audit_system.{status,queue_depth}/redis.status — and NEVER reads connection counters, URLs, env vars, or credentials", () => {
    const body = isolateHelperBody("getSystemInfo");
    expect(body).toMatch(/d\?\.status|d\.status/);
    expect(body).toMatch(/d\?\.version|d\.version/);
    expect(body).toMatch(/db\.status/);
    expect(body).toMatch(/audit\.status/);
    expect(body).toMatch(/audit\.queue_depth/);
    expect(body).toMatch(/redis/);
    // The backend's `database.connections` carries pool stats; the
    // UI MUST NOT read them (they're operational metrics that we
    // intentionally do not surface here — they belong on a deeper
    // operator-only debugging surface, out of scope for this slice).
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/connections/);
    expect(stripped).not.toMatch(/acquire/i);
    expect(stripped).not.toMatch(/max_conns/);
    // Defence-in-depth — none of these fields exist in the backend
    // response, but the projection must not declare them either.
    const BANNED: RegExp[] = [
      /database_url/i,
      /db_url/i,
      /redis_url/i,
      /env_var/i,
      /\bsecret\b/,
      /license_private/i,
      /signing_key/i,
    ];
    for (const pat of BANNED) {
      expect(stripped, `getSystemInfo must not reference ${pat}`).not.toMatch(pat);
    }
  });
});

// ── SITE_ADMIN_REPORT_FAMILIES: shape + safe paths ──────────────────────────

describe("SITE_ADMIN_REPORT_FAMILIES — pure metadata, no eager fetch", () => {
  it("declares exactly four report families with documented keys", () => {
    expect(WIRE_SRC).toMatch(/export const SITE_ADMIN_REPORT_FAMILIES:\s*ReportFamily\[\]\s*=/);
    expect(WIRE_SRC).toMatch(/key:\s*"user_access"/);
    expect(WIRE_SRC).toMatch(/key:\s*"failed_auth"/);
    expect(WIRE_SRC).toMatch(/key:\s*"privilege_changes"/);
    expect(WIRE_SRC).toMatch(/key:\s*"audit_log"/);
  });

  it("each report path roots at /api/v1/reports and uses safe extensions only", () => {
    const pathMatches = WIRE_SRC.match(/path:\s*"\/api\/v1\/reports[^"]*"/g) ?? [];
    expect(pathMatches.length).toBeGreaterThan(0);
    for (const m of pathMatches) {
      expect(m).toMatch(
        /\/api\/v1\/reports\/(access\/users|auth\/failed|privileges\/changes|audit\/events)(\.csv|\.pdf)?"$/
      );
    }
  });
});

// ── Per-page invariants — pure source-text pins on each new page ────────────

function readPage(...segments: string[]): string {
  return readFileSync(
    resolve(__dirname, "..", "app", "site-admin", ...segments, "page.tsx"),
    "utf-8"
  );
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("/site-admin/keys page — read-only signing-key list", () => {
  const SRC = readPage("keys");
  const NO_COMMENTS = stripComments(SRC);

  it("calls listSigningKeys via the wire helper", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*listSigningKeys\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/await\s+listSigningKeys\(\)/);
  });

  it("renders the documented heading", () => {
    expect(SRC).toMatch(/<h1[^>]*>\s*Signing keys\s*<\/h1>/);
  });

  it("renders NO mutation controls (no <form>, no submit button, no <button> labelled Generate/Rotate/Deprecate/Reload)", () => {
    // The operator-facing ErrorPanel copy legitimately says "Reload
    // the page or try again later"; the assertion targets buttons /
    // links labelled with those verbs rather than the words in any
    // context. Pin <form>, submit buttons, and any <button> whose
    // text content contains the mutation verbs.
    expect(NO_COMMENTS).not.toMatch(/<form/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*type="submit"/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Generate\b/i);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Rotate\b/i);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Deprecate\b/i);
    // Reload-the-page operator copy is legitimate; we pin no
    // <button>Reload signing keys</button>-shaped control.
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Reload signing keys\b/i);
  });

  it("does NOT render private key / JWKS-private / token / secret fields anywhere", () => {
    const BANNED: RegExp[] = [
      /\bprivate_key\b/,
      /\bprivate_pem\b/,
      /\bseed\b/,
      /\bjwks_private\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bBearer\b/,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(NO_COMMENTS, `keys page must not render ${pat}`).not.toMatch(pat);
    }
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/anomaly page — stats + recent events", () => {
  const SRC = readPage("anomaly");
  const NO_COMMENTS = stripComments(SRC);

  it("calls listAnomalyEvents + getAnomalyStats in parallel", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*getAnomalyStats,\s*listAnomalyEvents\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(
      /Promise\.all\(\[\s*\n?\s*getAnomalyStats\(\),\s*\n?\s*listAnomalyEvents\(\)/
    );
  });

  it("renders the documented heading", () => {
    expect(SRC).toMatch(/<h1[^>]*>\s*Anomaly\s*<\/h1>/);
  });

  it("renders Enterprise/CE boundary copy for direct OSS/feature-absent access", () => {
    expect(SRC).toContain("FeatureBoundaryPanel");
    expect(SRC).toContain("Anomaly statistics require Enterprise/CE");
    expect(SRC).toContain("Anomaly events require Enterprise/CE");
    expect(SRC).toContain("IDP OSS");
  });

  it("does NOT render raw metadata / IP / user-agent / token / secret fields", () => {
    const BANNED: RegExp[] = [
      /\bip_address\b/,
      /\buser_agent\b/,
      /JSON\.stringify\(/,
      /\.metadata\b/,
      /\bclient_secret\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
    ];
    for (const pat of BANNED) {
      expect(NO_COMMENTS, `anomaly page must not render ${pat}`).not.toMatch(pat);
    }
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/audit page — direct CE boundary", () => {
  const SRC = readPage("audit");

  it("renders Enterprise/CE boundary copy for direct OSS/feature-absent access", () => {
    expect(SRC).toContain("FeatureBoundaryPanel");
    expect(SRC).toContain("Audit log requires Enterprise/CE");
    expect(SRC).toContain("IDP OSS");
    expect(SRC).not.toContain("Audit log requires Professional tier");
  });
});

describe("/org-admin/audit page — direct CE boundary", () => {
  const SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "audit", "page.tsx"),
    "utf-8"
  );

  it("renders Enterprise/CE boundary copy for direct OSS/feature-absent access", () => {
    expect(SRC).toContain("FeatureBoundaryPanel");
    expect(SRC).toContain("Audit log requires Enterprise/CE");
    expect(SRC).toContain("IDP OSS");
    expect(SRC).not.toContain("Audit log requires Professional tier");
  });
});

describe("/site-admin/reports page — landing", () => {
  const SRC = readPage("reports");
  const NO_COMMENTS = stripComments(SRC);

  it("imports SITE_ADMIN_REPORT_FAMILIES + ReportLink type", () => {
    const importBlock = SRC.match(
      /import\s*\{([\s\S]*?)\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock?.[1]).toMatch(/\bSITE_ADMIN_REPORT_FAMILIES\b/);
    expect(importBlock?.[1]).toMatch(/\btype\s+ReportLink\b/);
  });

  it("renders the documented heading", () => {
    expect(SRC).toMatch(/<h1[^>]*>\s*Reports\s*<\/h1>/);
  });

  it("renders Enterprise/CE boundary copy while preserving report links for CE deployments", () => {
    expect(SRC).toContain("FeatureBoundaryPanel");
    expect(SRC).toContain("Reports require Enterprise/CE");
    expect(SRC).toContain("IDP OSS");
    expect(SRC).toContain("the links remain available for CE deployments");
    expect(SRC).toMatch(/href=\{`\/api\/idp\$\{link\.path\}`\}/);
  });

  it('does NOT auto-fetch / auto-download any report on render — links use href + target="_blank"', () => {
    // No `await fetch(...)` / `await listReports(...)`. The page
    // composes <a> elements pointing at /api/idp/<report-path>.
    expect(NO_COMMENTS).not.toMatch(/await\s+fetch\(/);
    expect(NO_COMMENTS).not.toMatch(/await\s+listReports/);
    expect(SRC).toMatch(/href=\{`\/api\/idp\$\{link\.path\}`\}/);
    expect(SRC).toMatch(/target="_blank"/);
    expect(SRC).toMatch(/rel="noreferrer"/);
  });

  it("renders NO mutation controls and NO secret-shaped fields", () => {
    expect(NO_COMMENTS).not.toMatch(/<form/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*type="submit"/);
    expect(NO_COMMENTS).not.toMatch(/\bclient_secret\b/);
    expect(NO_COMMENTS).not.toMatch(/\baccess_token\b/);
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/system landing page", () => {
  const SRC = readPage("system");
  const NO_COMMENTS = stripComments(SRC);

  it("renders the documented heading and three cards", () => {
    expect(SRC).toMatch(/<h1[^>]*>\s*System\s*<\/h1>/);
    expect(SRC).toMatch(/href:\s*"\/site-admin\/system\/sessions"/);
    expect(SRC).toMatch(/href:\s*"\/site-admin\/system\/audit-chain"/);
    expect(SRC).toMatch(/href:\s*"\/site-admin\/system\/info"/);
  });

  it("does not advertise license/product tier as runtime info before capability discovery exists", () => {
    expect(SRC).toContain("Version, dependency liveness, and audit-queue depth.");
    expect(SRC).not.toMatch(/product tier/i);
  });

  it("does NOT advertise mutating system actions as clickable cards / forms / submits", () => {
    // The page's prose intentionally names "emergency revoke, backup
    // restore, compliance attest" as actions that are NOT available;
    // we pin the absence of actual clickable affordances rather than
    // the verb words themselves.
    expect(NO_COMMENTS).not.toMatch(/<form/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*type="submit"/);
    expect(NO_COMMENTS).not.toMatch(/href:\s*"[^"]*\/revoke"/);
    expect(NO_COMMENTS).not.toMatch(/href:\s*"[^"]*\/restore"/);
    expect(NO_COMMENTS).not.toMatch(/href:\s*"[^"]*\/attest"/);
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/system/sessions page — read-only", () => {
  const SRC = readPage("system", "sessions");
  const NO_COMMENTS = stripComments(SRC);

  it("calls listAdminSessions and renders the documented heading", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*listAdminSessions\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/await\s+listAdminSessions\(\)/);
    expect(SRC).toMatch(/<h1[^>]*>\s*Admin sessions\s*<\/h1>/);
  });

  it("does NOT render emergency-revoke or any mutation control as a clickable affordance", () => {
    // The page's prose explains that emergency-revoke is NOT
    // available; we pin the absence of the affordance, not the
    // absence of the word.
    expect(NO_COMMENTS).not.toMatch(/<form/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*type="submit"/);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Revoke\b/i);
    expect(NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Emergency revoke\b/i);
    expect(NO_COMMENTS).not.toMatch(/href="[^"]*\/emergency-revoke"/);
  });

  it("does NOT render token / cookie / session-material fields", () => {
    const BANNED: RegExp[] = [
      /\bs\.token\b/,
      /\bs\.cookie\b/,
      /\bs\.selector\b/,
      /\bs\.validator\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bsession_token\b/,
      /Set-Cookie/i,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(NO_COMMENTS, `sessions page must not render ${pat}`).not.toMatch(pat);
    }
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/system/audit-chain page — opt-in verify", () => {
  const SRC = readPage("system", "audit-chain");
  const NO_COMMENTS = stripComments(SRC);

  it('calls verifyAuditChain ONLY when searchParams.verify === "true"', () => {
    expect(SRC).toMatch(
      /import\s*\{\s*verifyAuditChain\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/const\s+shouldVerify\s*=\s*params\.verify\s*===\s*"true"/);
    expect(SRC).toMatch(
      /const\s+result\s*=\s*shouldVerify\s*\?\s*await\s+verifyAuditChain\(\)\s*:\s*null/
    );
  });

  it("renders the documented heading + the Verify-audit-chain trigger as a link (not a form POST)", () => {
    expect(SRC).toMatch(/<h1[^>]*>\s*Audit chain verify\s*<\/h1>/);
    expect(SRC).toMatch(
      /href="\/site-admin\/system\/audit-chain\?verify=true"[\s\S]*?Verify audit chain/
    );
  });

  it("does NOT render per-shard head_hash / head_signature hex strings", () => {
    expect(NO_COMMENTS).not.toMatch(/s\.head_hash/);
    expect(NO_COMMENTS).not.toMatch(/s\.head_signature\b/);
    expect(NO_COMMENTS).not.toMatch(/s\.head_signed_kid/);
  });

  it("renders Enterprise/CE boundary copy for direct OSS/feature-absent audit-chain access", () => {
    expect(SRC).toContain("FeatureBoundaryPanel");
    expect(SRC).toContain("Audit chain verification requires Enterprise/CE");
    expect(SRC).toContain("IDP OSS");
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

describe("/site-admin/system/info page — read-only", () => {
  const SRC = readPage("system", "info");
  const NO_COMMENTS = stripComments(SRC);

  it("calls getSystemInfo and renders the documented heading", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*getSystemInfo\s*\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(SRC).toMatch(/await\s+getSystemInfo\(\)/);
    expect(SRC).toMatch(/<h1[^>]*>\s*Runtime info\s*<\/h1>/);
  });

  it("does NOT render env vars / database URLs / Redis URLs / connection counters / credentials", () => {
    const BANNED: RegExp[] = [
      /database_url/i,
      /db_url/i,
      /redis_url/i,
      /\bDATABASE_/,
      /\bREDIS_/,
      /\bsecret\b/,
      /\bpassword\b/,
      /\bsigning_key\b/,
      /\bprivate_key\b/,
      /\benv_var\b/i,
      /connections/,
      /acquire/i,
      /max_conns/,
    ];
    for (const pat of BANNED) {
      expect(NO_COMMENTS, `system info page must not render ${pat}`).not.toMatch(pat);
    }
  });

  it("has NO console.* call", () => {
    expect(NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});

// ── Cross-page invariant: NO localStorage / sessionStorage / document.cookie ──

describe("All six new pages — no browser storage primitives", () => {
  const pages = [
    readPage("keys"),
    readPage("anomaly"),
    readPage("reports"),
    readPage("system"),
    readPage("system", "sessions"),
    readPage("system", "audit-chain"),
    readPage("system", "info"),
  ];
  for (const [i, raw] of pages.entries()) {
    const NO_COMMENTS = stripComments(raw);
    it(`page ${i} writes nothing to localStorage / sessionStorage / document.cookie / window.history / router.push`, () => {
      expect(NO_COMMENTS).not.toMatch(/localStorage/);
      expect(NO_COMMENTS).not.toMatch(/sessionStorage/);
      expect(NO_COMMENTS).not.toMatch(/document\.cookie/);
      expect(NO_COMMENTS).not.toMatch(/window\.history/);
      expect(NO_COMMENTS).not.toMatch(/router\.push/);
    });
  }
});
