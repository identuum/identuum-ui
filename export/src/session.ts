/**
 * Session validation and setup-state discovery for the static export.
 *
 * These adapt, in the browser, the two server-side decisions the Next
 * runtime used to make (src/lib/server-session.ts, src/lib/runtime-composition.ts
 * and src/app/page.tsx): the tri-state session verdict with its retry budget,
 * and the boot ladder. The session verdict and retry engine is shared; what changed is only
 * where the code runs. Authorization stays Go's — this file only decides what
 * to render or where to send the browser.
 */

import { upgradeStateNeedsWizard } from "@/lib/runtime-composition";
import { validateSessionResponse } from "@/lib/session-validation";
import type { IdpUpgradeStateView } from "@/lib/types";
import { bff, direct, readJson } from "./bff";

export type UserRole = "site_admin" | "org_admin" | "org_user";

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  organization_id?: string;
  mfa_enabled?: boolean;
}

export type SessionState =
  | { kind: "authenticated"; user: SessionUser; role: UserRole }
  | { kind: "unauthenticated"; reason: string }
  | {
      kind: "unavailable";
      status?: number;
      correlationId?: string;
      retryAfterSeconds?: number;
      attempts: number;
    };

export async function validateSession(): Promise<SessionState> {
  const state = await validateSessionResponse((signal) => bff("/api/v1/validate", { signal }));
  if (state.kind === "authenticated") {
    const user = state.session?.user;
    if (
      !user ||
      typeof user.id !== "string" ||
      user.id.trim() === "" ||
      !["site_admin", "org_admin", "org_user"].includes(user.role) ||
      (state.session.role !== undefined && state.session.role !== user.role)
    ) {
      return { kind: "unavailable", attempts: 1 };
    }
    return {
      kind: "authenticated",
      user: user as SessionUser,
      role: user.role as UserRole,
    };
  }
  if (state.kind === "unauthenticated") {
    return { kind: "unauthenticated", reason: state.reason ?? "unauthenticated" };
  }
  return {
    kind: "unavailable",
    status: state.status ?? undefined,
    correlationId: state.correlationId ?? undefined,
    retryAfterSeconds: state.retryAfterSeconds ?? undefined,
    attempts: state.attempts,
  };
}

// ----------------------------------------------------------- setup state

export type SetupState = "setup_required" | "setup_complete" | "unknown";

export type PlatformState =
  | { mode: "unavailable"; detail: string }
  | { mode: "upgrade_required" }
  | { mode: "setup_required" }
  | { mode: "ready" };

export const DISCOVERY_TIMEOUT_MS = 5000;

/** The boot ladder of src/app/page.tsx, reduced to the IdP-only states. */
export async function discoverPlatform(): Promise<PlatformState> {
  let component: Response;
  try {
    component = await direct("/api/v1/component", DISCOVERY_TIMEOUT_MS);
  } catch {
    return { mode: "unavailable", detail: "component_unreachable" };
  }
  if (!component.ok) {
    // A CE binary in upgrade mode mounts only /healthz and /api/upgrade/*:
    // its absent component is the Next ladder's cue to ask the upgrade
    // status (runtime-composition.ts fetchIdpUpgradeState).
    if (component.status === 404 && (await upgradeNeedsWizard())) {
      return { mode: "upgrade_required" };
    }
    return { mode: "unavailable", detail: `component_${component.status}` };
  }
  let setup: Response;
  try {
    setup = await direct("/api/setup/status", DISCOVERY_TIMEOUT_MS);
  } catch {
    return { mode: "unavailable", detail: "setup_status_unreachable" };
  }
  if (!setup.ok) {
    // A missing or failing setup probe is never collapsed into
    // setup_required (runtime-composition.ts:280-289).
    return { mode: "unavailable", detail: `setup_status_${setup.status}` };
  }
  const body = await readJson(setup);
  if (body?.state === "setup_required") return { mode: "setup_required" };
  if (body?.state === "setup_complete") return { mode: "ready" };
  return { mode: "unavailable", detail: "setup_state_unknown" };
}

/** Whether /api/upgrade/status reports a state the /upgrade wizard is for;
 * any failure or other state is no. */
async function upgradeNeedsWizard(): Promise<boolean> {
  try {
    const res = await direct("/api/upgrade/status", DISCOVERY_TIMEOUT_MS);
    if (!res.ok) return false;
    const state = (await readJson(res))?.state;
    return (
      typeof state === "string" && upgradeStateNeedsWizard(state as IdpUpgradeStateView["state"])
    );
  } catch {
    return false;
  }
}
