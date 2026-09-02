/**
 * Server-side client for the self-service profile write
 * (THE-PROFILE-CLAIMS): PUT /api/v1/profile — the caller's own display name
 * and OIDC Core §5.1 profile fields. The target is always the authenticated
 * session's user; no user id crosses the wire.
 */
import "server-only";

import { cookies } from "next/headers";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type { ProfileFieldKey } from "./types";

async function idpAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const all = (await cookies()).getAll();
  const headers: Record<string, string> = {
    ...extra,
    Cookie: all.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  const accessToken = all.find((c) => c.name === "access_token")?.value;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

/** Patch body: absent = unchanged, "" = clear. */
export type OwnProfilePatch = Partial<Record<ProfileFieldKey | "name", string>>;

export type UpdateOwnProfileResult =
  | { ok: true }
  | { ok: false; status: number; message: string; unavailable: boolean };

/**
 * Sends the patch to PUT /api/v1/profile. A 400 carries the IdP's
 * field-level message (safe policy prose, e.g. "website must be an absolute
 * http(s) URL"); 404/501/503 read as "unavailable" (older IdP without the
 * route). Never throws.
 */
export async function updateOwnProfile(patch: OwnProfilePatch): Promise<UpdateOwnProfileResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) {
    return { ok: false, status: 503, message: "Identity provider unavailable.", unavailable: true };
  }
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/profile`, {
      method: "PUT",
      headers: await idpAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    let message = "Could not update your profile.";
    if (res.status === 400) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: raw API error envelope
        const data: any = await res.json();
        if (typeof data?.message === "string" && data.message.length > 0) message = data.message;
      } catch {
        // keep the generic message
      }
    }
    return {
      ok: false,
      status: res.status,
      message,
      unavailable: res.status === 404 || res.status === 501 || res.status === 503,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      message: "Network error. Please try again.",
      unavailable: false,
    };
  }
}
