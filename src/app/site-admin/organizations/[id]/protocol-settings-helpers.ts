/**
 * Pure helpers for the org protocol settings panel.
 *
 * Extracted from the client component so they can be unit-tested in
 * the project's node-only vitest environment without jsdom/React.
 *
 * SECURITY: these helpers operate on display strings and boolean flags
 * only. No DCR tokens, IATs, RATs, client_secret values, signing
 * material, or raw credential bytes pass through these functions.
 */

import type { GetOrgProtocolSettingsResult, OrgProtocolSettings } from "@/lib/types";

/**
 * Human-readable label for the settings source.
 * "default"  → "System default (not explicitly configured)"
 * "explicit" → "Explicitly configured"
 */
export function formatSettingsSource(source: OrgProtocolSettings["source"]): string {
  return source === "explicit"
    ? "Explicitly configured"
    : "System default (not explicitly configured)";
}

/**
 * Returns true when the org has not been explicitly configured yet
 * (both booleans are false AND source is "default").
 *
 * Used by the panel to show a contextual note that the operator has
 * not yet enabled either protocol setting for this organization.
 */
export function isDefaultUnset(settings: OrgProtocolSettings): boolean {
  return (
    settings.source === "default" &&
    !settings.dynamic_client_registration_enabled &&
    !settings.scim_enabled
  );
}

/**
 * Returns a safe user-facing message for a failed GET (load) result.
 *
 * Called by the panel when initialSettings is null or ok=false.
 * Copy is role-neutral — does not name site_admin or org_admin.
 * Never returns a string that exposes internal URLs, tokens, or raw backend error text.
 * Does not claim SCIM is an OSS/Foundation/Starter feature.
 */
export function protocolSettingsLoadErrorMessage(
  result: GetOrgProtocolSettingsResult | null
): string {
  if (!result) {
    return "Protocol settings are unavailable — the identity provider did not respond. Check that the IDP is running and accessible.";
  }
  if (result.ok) {
    return "";
  }
  const { reason } = result;
  if (reason === "not_authenticated") {
    return "Your session has expired. Please sign in again to manage protocol settings.";
  }
  if (reason === "forbidden") {
    return "You do not have access to manage this organization's protocol settings.";
  }
  if (reason === "not_licensed") {
    return "Advanced protocol capabilities for this organization require a commercial license tier. DCR Foundation remains available on the current plan; SCIM 2.0 requires Enterprise/CE.";
  }
  if (reason === "not_found") {
    return "Protocol settings are not available for this organization. The identity provider may not support this feature in the current deployment.";
  }
  if (reason === "unavailable") {
    return "Protocol settings are unavailable — the identity provider did not respond. Check that the IDP is running and accessible.";
  }
  return "Protocol settings could not be loaded. The identity provider returned an unexpected response.";
}

/**
 * Returns a safe user-facing error message for a failed PUT, given
 * the discriminated result fields.
 *
 * Never returns a string that exposes internal URL, token, or raw
 * backend error text.
 */
export function protocolSettingsSaveErrorMessage(opts: {
  notFound: boolean;
  forbidden: boolean;
  unavailable?: boolean;
  notLicensed?: boolean;
  status: number;
}): string {
  if (opts.notFound) {
    return "Protocol settings are not available for this organization in the current identity provider deployment.";
  }
  if (opts.forbidden)
    return "You do not have permission to change protocol settings for this organization.";
  if (opts.notLicensed) {
    return "Advanced protocol capabilities for this organization require a commercial license tier. DCR Foundation remains available on the current plan; SCIM 2.0 requires Enterprise/CE.";
  }
  if (opts.unavailable) {
    return "Protocol settings could not be saved because the identity provider is unavailable. Check that the IDP is running and accessible.";
  }
  if (opts.status === 0) return "Network error. Check connectivity and try again.";
  return "Could not save protocol settings. Try again.";
}
