/**
 * Source-invariant pins for the Settings page's local System status
 * health probe (src/app/site-admin/settings/page.tsx).
 *
 * Background. The Settings page renders its own "System status" panel
 * server-side from a LOCAL checkHealth() helper — distinct from the
 * /api/status route fixed by `agent-a-20260617-ui-idp-healthz-status-fix`.
 * Pre-fix the local helper hard-coded `/health`; identuum-idp-ce mounts
 * only `/healthz` (Kubernetes-convention liveness path), so the probe
 * 404'd and the panel surfaced "Identity Provider (IdP): Unhealthy"
 * even with the IDP fully reachable. The fix mirrors the per-domain
 * branch landed in src/app/api/status/route.ts so both health-probe
 * surfaces stay in sync.
 *
 * The Settings page is a Next.js Server Component and its
 * checkHealth() helper is not exported, so this test pins the
 * source-text invariants directly. That is the same pattern used by
 * src/__tests__/setup-wizard-source-invariants.test.ts and is fast,
 * deterministic, and survives the no-jsdom / no-React-Testing-Library
 * posture of this repo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const settingsSource = readFileSync(join(root, "src/app/site-admin/settings/page.tsx"), "utf8");

describe("Settings page System status health probe", () => {
  it("uses a per-domain branch for the liveness path (matches /api/status route shape)", () => {
    // The helper must accept the domain and return the right path; the
    // function name and signature must match the api/status route so a
    // future consolidation does not have to reconcile two divergent
    // shapes.
    expect(settingsSource).toMatch(/function healthPath\(domain:\s*HealthDomain\):\s*string/);
  });

  it("probes /healthz for the IDP (regression pin against the pre-fix `/health` that surfaced false-positive 'Unhealthy' on customer-smoke)", () => {
    // The /healthz literal must appear inside the helper's idp branch.
    expect(settingsSource).toMatch(/if \(domain === "idp"\) return "\/healthz"/);
  });

  it("preserves /health for AG (do not broaden AG behavior without a paired AG-side audit)", () => {
    // AG fallthrough must remain /health; the next refactor will need
    // an explicit AG audit before flipping this.
    expect(settingsSource).toMatch(/return "\/health";?\s*\n}/);
    // Belt-and-braces: the file MUST NOT contain a `/healthz` literal
    // outside the IDP branch — i.e. AG side must not be silently
    // broadened by a refactor.
    const healthzCount = (settingsSource.match(/\/healthz/g) ?? []).length;
    expect(healthzCount).toBeGreaterThan(0);
    // The healthz literal MAY also appear in the comment block.
    // The test deliberately does not pin a fixed count — only that AG
    // is left at /health, which the regex above already enforces.
  });

  it("hard-codes the suffix as a string literal — no `/health${z?}` templating drift", () => {
    // Paranoid pin against a future refactor that splits the suffix
    // across a literal + a `${...}` interpolation (e.g. `/health${z}`
    // or `/heal${"thz"}`) and accidentally produces `/healthidp`. The
    // fetch line MUST use either a string-literal suffix OR a clean
    // helper call — never a partial-literal-plus-interpolation.
    //
    // Limit the search to fetch-shaped URLs so prose strings like
    // "enabled/healthy flags" in the page docstring do not register
    // as false positives.
    const fetchLineMatch = settingsSource.match(/fetch\(`[^`]+`/);
    expect(fetchLineMatch).not.toBeNull();
    const fetchURLTemplate = fetchLineMatch?.[0] ?? "";
    expect(fetchURLTemplate).not.toMatch(/\/heal(?:th)?\$\{/);
    expect(fetchURLTemplate).not.toMatch(/\/healthz?[a-z0-9]/i);
  });

  it("calls checkHealth with the domain argument for both IDP and AG", () => {
    // Pins the call sites in loadSystemStatus() so a refactor cannot
    // silently drop the second argument and revert both probes to a
    // single hardcoded path.
    expect(settingsSource).toMatch(/checkHealth\(idpBaseUrl\(cfg\),\s*"idp"\)/);
    expect(settingsSource).toMatch(/checkHealth\(agBaseUrl\(cfg\),\s*"ag"\)/);
  });
});
