/**
 * Browser transport for the IdP admin client (the static export).
 *
 * Every request goes through the Go boundary under /bff: the binary lifts the
 * HttpOnly access cookie to a Bearer, requires the browser proof header on
 * every request (bff() sets it), renews an expired access credential for safe
 * reads, and validates before a mutation. Page script adds no credential.
 */
import { bff } from "../bff";

export async function idpAuthHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  return { ...extra };
}

/** `input` is the admin client's `${idpBaseUrl(cfg)}/api/v1/...`; here the base is "". */
export function idpFetch(input: string, init?: RequestInit): Promise<Response> {
  return bff(input, init);
}
