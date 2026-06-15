/**
 * Pure helper functions for the PolicyPacks settings panel.
 *
 * No server-only imports — testable in the vitest node environment and
 * safe to import in both server and client contexts.
 */

export function policyPackSaveErrorMessage({ status }: { status: number }): string {
  if (status === 503) {
    return "The AG backend is temporarily unavailable (fail-closed). PolicyPacks enforcement remains active. Try again in a moment.";
  }
  if (status === 0) {
    return "Network error. Check that the AG backend is reachable and try again.";
  }
  return "Could not save PolicyPacks settings. Try again or contact support.";
}
