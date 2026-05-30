/**
 * org-linking-readiness.ts
 *
 * Pure helper for deriving IDP↔AG organization linking readiness from
 * backend component discovery state. No rendering, no server-only imports —
 * testable in any environment.
 *
 * Scope: organizations only. This helper never evaluates readiness for
 * user import, password import, MFA import, org admin assignment, role
 * binding import, reviewer/auditor import, or any credential transfer.
 *
 * Safe field contract: reads only ComponentCapabilities fields and the
 * typed BackendComponentState fields already validated by runtime-composition.
 * Never reads entitlements, features, customer_id, license_id, signature,
 * ciphertext, key material, user data, passwords, or MFA state.
 */

import type { ComponentCapabilities, RuntimeState } from "./types";

/** A single prerequisite check for organization linking readiness. */
export interface LinkingPrerequisite {
  /** True when this prerequisite is satisfied. */
  met: boolean;
  /** Concise human-readable label for the requirement. */
  label: string;
  /** Message shown when met=false (explains what is missing). */
  failMessage: string;
}

/** Full readiness result for the organization linking flow. */
export interface OrganizationLinkingReadiness {
  /** True only when every prerequisite is met. */
  ready: boolean;
  /** Ordered list of prerequisites. Always contains all checks regardless of met state. */
  prerequisites: LinkingPrerequisite[];
}

function capMet(caps: ComponentCapabilities, key: keyof ComponentCapabilities): boolean {
  return caps[key] === true;
}

/**
 * deriveOrganizationLinkingReadiness evaluates whether IDP↔AG organization
 * linking can proceed based on the current discovered runtime state.
 *
 * Ready only when:
 *   - IDP backend is configured and usable
 *   - IDP reports organization_export=true
 *   - IDP reports organization_linking=true
 *   - AG backend is configured and usable
 *   - AG reports organization_import=true
 *   - AG reports organization_linking=true
 *
 * Older backends without a capabilities object yield met=false for capability
 * checks, but do not throw.
 */
export function deriveOrganizationLinkingReadiness(
  state: RuntimeState
): OrganizationLinkingReadiness {
  const { idp, ag } = state.components;

  const prerequisites: LinkingPrerequisite[] = [
    {
      met: idp.configured,
      label: "Identity Provider backend configured",
      failMessage: "Identity Provider backend is not configured.",
    },
    {
      met: idp.usable,
      label: "Identity Provider backend reachable and usable",
      failMessage: idp.configured
        ? "Identity Provider backend is unreachable."
        : "Identity Provider backend is not configured.",
    },
    {
      met: capMet(idp.capabilities, "organization_export"),
      label: "Identity Provider reports organization export capability",
      failMessage: "Identity Provider does not report organization export capability.",
    },
    {
      met: capMet(idp.capabilities, "organization_linking"),
      label: "Identity Provider reports organization linking capability",
      failMessage: "Identity Provider does not report organization linking capability.",
    },
    {
      met: ag.configured,
      label: "Agent Governance backend configured",
      failMessage: "Agent Governance backend is not configured.",
    },
    {
      met: ag.usable,
      label: "Agent Governance backend reachable and usable",
      failMessage: ag.configured
        ? "Agent Governance backend is unreachable."
        : "Agent Governance backend is not configured.",
    },
    {
      met: capMet(ag.capabilities, "organization_import"),
      label: "Agent Governance reports organization import capability",
      failMessage: "Agent Governance does not report organization import capability.",
    },
    {
      met: capMet(ag.capabilities, "organization_linking"),
      label: "Agent Governance reports organization linking capability",
      failMessage: "Agent Governance does not report organization linking capability.",
    },
  ];

  const ready = prerequisites.every((p) => p.met);

  return { ready, prerequisites };
}
