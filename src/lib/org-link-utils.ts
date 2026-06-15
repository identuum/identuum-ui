/**
 * org-link-utils.ts
 *
 * Pure utility functions for org-link operations.
 * No server-only restriction — safe to import in tests and client code.
 */

/** UUID pattern for input validation before forwarding to AG. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_PATTERN.test(value);
}
