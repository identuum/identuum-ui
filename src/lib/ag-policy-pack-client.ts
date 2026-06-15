/**
 * Server-side AG client for PolicyPacks org-level settings.
 *
 * Calls:
 *   GET  /api/v1/policy-packs/settings → { policy_packs_enabled: bool }
 *   PATCH /api/v1/policy-packs/settings → body { policy_packs_enabled: bool }
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; the token value
 *     is never forwarded to browser code or included in client props.
 *   - sanitizeAgPolicyPackSettings extracts only the boolean field; unknown
 *     keys, internal config, or credential material are discarded.
 *   - No raw error bodies, internal URLs, or signing material are returned.
 *
 * Fail-closed semantics (503 on GET):
 *   A 503 from the AG backend means the settings lookup encountered an error
 *   and enforcement continues fail-closed. This is NOT the same as the
 *   operator having set policy_packs_enabled=false. Both map to "unavailable"
 *   here; the UI surfaces the distinction via informational copy.
 */
import "server-only";

import { agRequest } from "./ag-client";
import type { AgPolicyPackSettings } from "./types";

function sanitizeAgPolicyPackSettings(raw: unknown): AgPolicyPackSettings {
  if (raw === null || typeof raw !== "object") {
    return { policy_packs_enabled: true };
  }
  const obj = raw as Record<string, unknown>;
  return {
    policy_packs_enabled: Boolean(obj.policy_packs_enabled ?? true),
  };
}

export async function getAgPolicyPackSettings(): Promise<
  AgPolicyPackSettings | "auth_error" | "unavailable"
> {
  const res = await agRequest("/api/v1/policy-packs/settings");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    return sanitizeAgPolicyPackSettings(await res.json());
  } catch {
    return "unavailable";
  }
}

export type UpdateAgPolicyPackSettingsResult =
  | { ok: true; settings: AgPolicyPackSettings }
  | { ok: false; authError: boolean; status: number };

export async function updateAgPolicyPackSettings(
  enabled: boolean
): Promise<UpdateAgPolicyPackSettingsResult> {
  const res = await agRequest("/api/v1/policy-packs/settings", {
    method: "PATCH",
    body: JSON.stringify({ policy_packs_enabled: enabled }),
  });
  if (!res) return { ok: false, authError: false, status: 0 };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, authError: true, status: res.status };
  }
  if (!res.ok) return { ok: false, authError: false, status: res.status };
  try {
    return { ok: true, settings: sanitizeAgPolicyPackSettings(await res.json()) };
  } catch {
    return { ok: false, authError: false, status: 0 };
  }
}
