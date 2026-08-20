/**
 * audit-chain-invite-source-invariants.test.ts — THE-AUDIT-SURFACE / AUDIT-CHAIN-INVITE-1
 *
 * The site-admin audit-chain page must PRE-GATE its verification invitation on
 * the discovered edition capability — the SAME source the System index and
 * site-admin nav consult (getServerRuntimeState → components.idp.capabilities).
 *
 * Measured 2026-08-20: identuum-idp-oss reports audit_chain=false (the
 * commercial audit-log capability is absent) and answers
 * GET /api/v1/system/audit/chain/verify with 404. Before this pin the page
 * always rendered "Ready to verify" + a "Verify audit chain" button, inviting
 * the operator to a click the OSS backend can only refuse. The pin holds the
 * gate so the invitation never mounts on OSS:
 *
 *   - audit_chain === false  ⇒  FeatureUnavailablePanel renders directly,
 *     the "Ready to verify" invite + Verify button never mount.
 *   - the verify path itself (shouldVerify) is ANDed with the capability, so
 *     even a hand-typed ?verify=true cannot reach verifyAuditChain() on OSS.
 *
 * Source-invariant style (no React render, no network) — matches
 * edition-surface-source-invariants.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const auditChainPage = src("app/site-admin/system/audit-chain/page.tsx");

describe("AUDIT-CHAIN-INVITE-1 — audit-chain verification is invited only where the edition serves it", () => {
  it("the page pre-gates the invite on the discovered audit_chain capability; unsupported ⇒ boundary only, no Verify button [AUDIT-CHAIN-INVITE-1]", () => {
    // (1) The page consults the discovered capabilities — the same source the
    // System index gates on — not a hardcoded assumption of support.
    expect(auditChainPage).toContain("getServerRuntimeState");
    expect(auditChainPage).toMatch(/components\.idp\.capabilities\??\.audit_chain/);

    // (2) Support is the tri-state predicate `audit_chain !== false`: a present
    // false hides the invite, and an ABSENT capability (undefined) is treated
    // as supported so a mis-shaped payload never silently hides an editon that
    // DOES serve it. Absence is load-bearing — never Boolean()-coerced.
    expect(auditChainPage).toMatch(
      /const auditChainSupported =[\s\S]*?audit_chain\s*!==\s*false/
    );
    expect(auditChainPage).not.toMatch(/Boolean\(\s*[^)]*\.audit_chain\s*\)/);

    // (3) The verify path is ANDed with the capability — a hand-typed
    // ?verify=true cannot reach verifyAuditChain() when the edition lacks it.
    expect(auditChainPage).toMatch(
      /const shouldVerify =\s*auditChainSupported && params\.verify === "true"/
    );

    // (4) Unsupported edition renders the boundary panel directly.
    expect(auditChainPage).toMatch(/\{!auditChainSupported && <FeatureUnavailablePanel/);

    // (5) The "Ready to verify" invite + Verify button are gated on the
    // capability — they never mount when audit_chain is false.
    expect(auditChainPage).toMatch(/\{auditChainSupported && !shouldVerify &&/);
    // The Verify button lives INSIDE the auditChainSupported-gated block, so on
    // OSS it is never rendered. Its href token exists exactly once, and the
    // gate opens before it.
    const gateIdx = auditChainPage.indexOf("{auditChainSupported && !shouldVerify &&");
    const verifyBtnIdx = auditChainPage.indexOf("/site-admin/system/audit-chain?verify=true");
    expect(gateIdx, "capability gate must be present").toBeGreaterThan(-1);
    expect(verifyBtnIdx, "Verify button href must be present").toBeGreaterThan(-1);
    expect(
      verifyBtnIdx,
      "the Verify button must sit AFTER the capability gate opens"
    ).toBeGreaterThan(gateIdx);
  });
});
