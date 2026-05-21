/**
 * navigation-mode.ts
 *
 * Pure helper that maps a PlatformMode to what the UI shell should show.
 * No React or Next.js imports — fully unit-testable.
 *
 * Rules:
 *   identity-only           — show Identity navigation only
 *   agent-governance-only   — show AG navigation only
 *   full-platform           — show both
 *   degraded-ag-unavailable — show Identity navigation; show AG-unavailable notice
 *   degraded-idp-unavailable— show AG navigation; show IDP-unavailable notice
 *   misconfigured           — show neither; show misconfigured problem screen
 *   unconfigured            — show neither; show setup guidance
 */

import type { PlatformMode } from "./types";

export interface NavigationVisibility {
  showIdentityNavigation: boolean;
  showAgNavigation: boolean;
  showIdpUnavailableNotice: boolean;
  showAgUnavailableNotice: boolean;
  showSetupRequired: boolean;
  showMisconfigured: boolean;
}

const IDENTITY_MODES: PlatformMode[] = [
  "identity-only",
  "full-platform",
  "degraded-ag-unavailable",
];
const AG_MODES: PlatformMode[] = [
  "agent-governance-only",
  "full-platform",
  "degraded-idp-unavailable",
];

export function navigationVisibility(mode: PlatformMode): NavigationVisibility {
  return {
    showIdentityNavigation: IDENTITY_MODES.includes(mode),
    showAgNavigation: AG_MODES.includes(mode),
    showIdpUnavailableNotice: mode === "degraded-idp-unavailable",
    showAgUnavailableNotice: mode === "degraded-ag-unavailable",
    showSetupRequired: mode === "unconfigured",
    showMisconfigured: mode === "misconfigured",
  };
}
