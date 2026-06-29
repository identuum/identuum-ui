/**
 * ag-ce-org-link-availability-card-render.test.tsx
 *
 * Real DOM rendering tests for the shared
 * `AGCEOrgLinkAvailabilityCard` component (2026-07-06 refactor).
 * Promotes the test contract from source-invariant string projection
 * to actual React rendering via `react-dom/server::renderToString` —
 * no new testing dependency required (`react-dom` is already in the
 * repo). Server-side render produces real HTML; the assertions then
 * inspect the rendered output rather than the component source code.
 *
 * Complements (does NOT replace) the source-invariant pins in
 * `ag-ce-org-link-availability-card-shared.test.ts`. The two test
 * files together cover:
 *   - this file: rendered DOM, attribute values, element presence /
 *     absence, variant branching, copy-variant rendering
 *   - source-invariant file: no server-only imports, no AG CE
 *     fetch-client imports, no derivation re-implementation, no
 *     credential-symbol access
 *
 * No new UI surfaces, no new AG CE endpoints, no AG CE source /
 * runtime changes, no new operator-token UI, no browser-visible
 * credential storage.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGCEOrgLinkAvailabilityCard } from "../components/shared/ag-ce-org-link-availability-card";
import type { AGCEOrgLinkAvailability } from "../lib/ag-ce-org-linking-availability";

// ───── Fixture constants ─────────────────────────────────────────

const ACTIONABLE: AGCEOrgLinkAvailability = { state: "actionable" };
const CAPABILITY_MISSING: AGCEOrgLinkAvailability = { state: "capability_missing" };
const READINESS_PENDING_WITH_REASONS: AGCEOrgLinkAvailability = {
  state: "readiness_pending",
  reasons: ["First operator action note", "Second operator action note"],
};
const READINESS_PENDING_EMPTY: AGCEOrgLinkAvailability = {
  state: "readiness_pending",
  reasons: [],
};
const READINESS_UNKNOWN_NOT_CONFIGURED: AGCEOrgLinkAvailability = {
  state: "readiness_unknown",
  reason: "not_configured",
};
const READINESS_UNKNOWN_AG_UNAVAILABLE: AGCEOrgLinkAvailability = {
  state: "readiness_unknown",
  reason: "ag_unavailable",
};
const READINESS_UNKNOWN_ERROR: AGCEOrgLinkAvailability = {
  state: "readiness_unknown",
  reason: "error",
};

const READINESS_TARGET = { href: "/site-admin/org-link/readiness", label: "Open readiness" };
const CONSOLE_TARGET = { href: "/site-admin/org-link", label: "Open the org-link console" };

// ───── Render helpers ────────────────────────────────────────────

function render(props: Parameters<typeof AGCEOrgLinkAvailabilityCard>[0]): string {
  return renderToString(<AGCEOrgLinkAvailabilityCard {...props} />);
}

// ───── Actionable variant — both copy variants ──────────────────

describe("AGCEOrgLinkAvailabilityCard render — actionable variant", () => {
  it("action-planning: renders the verbose heading + body + anchor with caller-supplied href and label", () => {
    const html = render({
      availability: ACTIONABLE,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    // Heading copy preserved BYTE-IDENTICAL from the 2026-07-03 inline.
    expect(html).toContain("AG organization linking available");
    // Body copy preserved.
    expect(html).toContain(
      "Agent Governance reports both the org-linking capability and that the read/write"
    );
    // Anchor href + label come from props.
    expect(html).toContain('href="/site-admin/org-link"');
    expect(html).toContain("Open the org-link console");
    // No CTA controls.
    expect(html).not.toMatch(/<button[\s>]/i);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/onClick=/i);
    expect(html).not.toMatch(/formAction=/i);
  });

  it("operational-health: renders the brief heading + body + anchor with caller-supplied href and label", () => {
    const html = render({
      availability: ACTIONABLE,
      actionableTarget: READINESS_TARGET,
      copyVariant: "operational-health",
    });
    // Heading copy preserved BYTE-IDENTICAL from the 2026-07-05 inline.
    expect(html).toContain("AG org-link surface ready");
    // Brief body copy.
    expect(html).toContain("AG advertises org-linking capability");
    // Anchor href + label come from props (the OTHER href than the
    // action-planning variant — proving the component is target-
    // agnostic).
    expect(html).toContain('href="/site-admin/org-link/readiness"');
    expect(html).toContain("Open readiness");
    // No CTA controls.
    expect(html).not.toMatch(/<button[\s>]/i);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/onClick=/i);
    expect(html).not.toMatch(/formAction=/i);
  });

  it("actionable in both variants uses the established emerald-toned card", () => {
    // The 2026-07-06 refactor preserved Tailwind classes BYTE-
    // IDENTICAL across copy variants for the rounded-xl emerald card
    // boundary. Pin both so a future visual regression surfaces.
    for (const cv of ["action-planning", "operational-health"] as const) {
      const html = render({
        availability: ACTIONABLE,
        actionableTarget: cv === "operational-health" ? READINESS_TARGET : CONSOLE_TARGET,
        copyVariant: cv,
      });
      expect(html).toContain("rounded-xl");
      expect(html).toContain("border-emerald-200");
      expect(html).toContain("bg-emerald-50");
    }
  });
});

// ───── Readiness pending — notes verbatim ────────────────────────

describe("AGCEOrgLinkAvailabilityCard render — readiness_pending variant", () => {
  it("renders each AG CE editorial note verbatim as a separate <li>", () => {
    const html = render({
      availability: READINESS_PENDING_WITH_REASONS,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    // Each reason appears verbatim. The rendered DOM contains a <li>
    // per reason.
    expect(html).toContain("First operator action note");
    expect(html).toContain("Second operator action note");
    // Both reason strings appear inside <li> elements. React's
    // server renderer may insert a `<!-- -->` separator between
    // adjacent text nodes — the regex below tolerates that.
    expect(html).toMatch(/<li[^>]*>.*?First operator action note/);
    expect(html).toMatch(/<li[^>]*>.*?Second operator action note/);
  });

  it("renders the action-planning heading when copyVariant is action-planning", () => {
    const html = render({
      availability: READINESS_PENDING_WITH_REASONS,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("AG organization linking not yet ready");
  });

  it("renders the operational-health heading when copyVariant is operational-health", () => {
    const html = render({
      availability: READINESS_PENDING_WITH_REASONS,
      actionableTarget: READINESS_TARGET,
      copyVariant: "operational-health",
    });
    expect(html).toContain("AG org-link surface pending");
  });

  it("renders NO <ul> list when reasons is empty (avoids an empty notes block)", () => {
    const html = render({
      availability: READINESS_PENDING_EMPTY,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).not.toMatch(/<ul[\s>]/i);
    expect(html).not.toMatch(/<li[\s>]/i);
  });

  it("renders NO CTA controls (no button, no form, no onClick, no formAction)", () => {
    const html = render({
      availability: READINESS_PENDING_WITH_REASONS,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).not.toMatch(/<button[\s>]/i);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/onClick=/i);
    expect(html).not.toMatch(/formAction=/i);
    // And no <a> link (the readiness_pending variant has no
    // actionable affordance even though the caller passes one).
    expect(html).not.toMatch(/<a\s+href/i);
  });

  it("uses the established amber-toned card boundary", () => {
    const html = render({
      availability: READINESS_PENDING_WITH_REASONS,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-amber-200");
    expect(html).toContain("bg-amber-50");
  });
});

// ───── Capability missing ────────────────────────────────────────

describe("AGCEOrgLinkAvailabilityCard render — capability_missing variant", () => {
  it("renders the action-planning heading + body", () => {
    const html = render({
      availability: CAPABILITY_MISSING,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("AG organization linking capability not advertised");
    expect(html).toContain("Agent Governance does not advertise");
  });

  it("renders the operational-health heading + body", () => {
    const html = render({
      availability: CAPABILITY_MISSING,
      actionableTarget: READINESS_TARGET,
      copyVariant: "operational-health",
    });
    expect(html).toContain("AG org-link capability not advertised");
    expect(html).toContain("AG does not advertise");
  });

  it("renders NO CTA controls (no button, no form, no onClick, no formAction, no <a>)", () => {
    const html = render({
      availability: CAPABILITY_MISSING,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).not.toMatch(/<button[\s>]/i);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/onClick=/i);
    expect(html).not.toMatch(/formAction=/i);
    expect(html).not.toMatch(/<a\s+href/i);
  });

  it("uses the neutral stone-toned card boundary", () => {
    const html = render({
      availability: CAPABILITY_MISSING,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-stone-200");
    expect(html).toContain("bg-white");
  });
});

// ───── Readiness unknown — reason discriminator mapping ─────────

describe("AGCEOrgLinkAvailabilityCard render — readiness_unknown variant", () => {
  it("renders 'not_configured' as 'No Agent Governance backend is configured for this UI.'", () => {
    const html = render({
      availability: READINESS_UNKNOWN_NOT_CONFIGURED,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("No Agent Governance backend is configured for this UI.");
    expect(html).not.toContain("did not respond to the readiness probe");
    expect(html).not.toContain("returned an unexpected readiness response");
  });

  it("renders 'ag_unavailable' as the 'did not respond to the readiness probe' copy", () => {
    const html = render({
      availability: READINESS_UNKNOWN_AG_UNAVAILABLE,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain(
      "Agent Governance is configured but did not respond to the readiness probe."
    );
    expect(html).not.toContain("No Agent Governance backend is configured");
    expect(html).not.toContain("returned an unexpected readiness response");
  });

  it("renders 'error' as the 'returned an unexpected readiness response' copy", () => {
    const html = render({
      availability: READINESS_UNKNOWN_ERROR,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("Agent Governance returned an unexpected readiness response.");
    expect(html).not.toContain("No Agent Governance backend is configured");
    expect(html).not.toContain("did not respond to the readiness probe");
  });

  it("renders the action-planning heading", () => {
    const html = render({
      availability: READINESS_UNKNOWN_NOT_CONFIGURED,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("AG organization linking status unavailable");
  });

  it("renders the operational-health heading", () => {
    const html = render({
      availability: READINESS_UNKNOWN_NOT_CONFIGURED,
      actionableTarget: READINESS_TARGET,
      copyVariant: "operational-health",
    });
    expect(html).toContain("AG org-link status unavailable");
  });

  it("renders NO CTA controls regardless of reason discriminator", () => {
    for (const variant of [
      READINESS_UNKNOWN_NOT_CONFIGURED,
      READINESS_UNKNOWN_AG_UNAVAILABLE,
      READINESS_UNKNOWN_ERROR,
    ]) {
      const html = render({
        availability: variant,
        actionableTarget: CONSOLE_TARGET,
        copyVariant: "action-planning",
      });
      expect(html).not.toMatch(/<button[\s>]/i);
      expect(html).not.toMatch(/<form[\s>]/i);
      expect(html).not.toMatch(/onClick=/i);
      expect(html).not.toMatch(/formAction=/i);
      expect(html).not.toMatch(/<a\s+href/i);
    }
  });

  it("uses the neutral stone-toned card boundary", () => {
    const html = render({
      availability: READINESS_UNKNOWN_NOT_CONFIGURED,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-stone-200");
    expect(html).toContain("bg-white");
  });
});

// ───── Cross-variant invariants ─────────────────────────────────

describe("AGCEOrgLinkAvailabilityCard render — cross-variant invariants", () => {
  it("ONLY the actionable variant renders an <a> link element; the other three are link-free", () => {
    const nonActionable = [
      READINESS_PENDING_WITH_REASONS,
      CAPABILITY_MISSING,
      READINESS_UNKNOWN_NOT_CONFIGURED,
      READINESS_UNKNOWN_AG_UNAVAILABLE,
      READINESS_UNKNOWN_ERROR,
    ];
    for (const variant of nonActionable) {
      const html = render({
        availability: variant,
        actionableTarget: CONSOLE_TARGET,
        copyVariant: "action-planning",
      });
      expect(html, `variant ${variant.state}: must render no <a> link`).not.toMatch(/<a\s+href/i);
    }
    // Actionable variant DOES render exactly one <a> link.
    const actionableHtml = render({
      availability: ACTIONABLE,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    const linkMatches = actionableHtml.match(/<a\s+href/gi) ?? [];
    expect(linkMatches).toHaveLength(1);
  });

  it("NO rendered HTML across ALL variants contains any operator-credential symbol", () => {
    const variants: AGCEOrgLinkAvailability[] = [
      ACTIONABLE,
      READINESS_PENDING_WITH_REASONS,
      CAPABILITY_MISSING,
      READINESS_UNKNOWN_NOT_CONFIGURED,
      READINESS_UNKNOWN_AG_UNAVAILABLE,
      READINESS_UNKNOWN_ERROR,
    ];
    const credentialNeedles = [
      "Authorization",
      "Bearer",
      "ag_operator_session",
      "AG_COOKIE_NAME",
      "operatorToken",
      "private_key",
      "PRIVATE KEY",
      "client_secret",
    ];
    for (const variant of variants) {
      for (const cv of ["action-planning", "operational-health"] as const) {
        const html = render({
          availability: variant,
          actionableTarget: cv === "operational-health" ? READINESS_TARGET : CONSOLE_TARGET,
          copyVariant: cv,
        });
        for (const needle of credentialNeedles) {
          expect(html, `variant ${variant.state}/${cv}: must not render ${needle}`).not.toContain(
            needle
          );
        }
      }
    }
  });

  it("respects the AG CE editorial-note contract (only string entries from availability.reasons rendered)", () => {
    // The 2026-07-02 client's sanitiser rejects non-string entries in
    // the readiness response's `notes` array. We additionally verify
    // here that a malformed availability (constructed by a misbehaving
    // upstream) does not crash the renderer — defense-in-depth.
    const tricky = {
      state: "readiness_pending" as const,
      reasons: ["safe note 1", "<script>alert('x')</script>", "safe note 3"],
    };
    const html = render({
      availability: tricky,
      actionableTarget: CONSOLE_TARGET,
      copyVariant: "action-planning",
    });
    // React escapes content by default; the <script> tag must appear
    // ONLY in its escaped form. (renderToString returns HTML with
    // `<` / `>` already encoded inside text nodes.)
    expect(html).toContain("safe note 1");
    expect(html).toContain("safe note 3");
    // Raw unescaped <script> tag must NOT appear.
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain("&lt;script&gt;");
  });
});
