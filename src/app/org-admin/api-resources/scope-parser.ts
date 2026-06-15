/**
 * Pure parser for the API-resource scope textarea.
 *
 * Lives in its own non-"use server" module so it can be synchronously
 * exported AND unit-tested. The actions.ts server action delegates to
 * this parser before issuing the wire call.
 *
 * Accepted row shapes (one per line):
 *   - "scope_name"                      → {name, description: ""}
 *   - "scope_name: human-readable text" → {name, description}
 *
 * Blank lines are stripped. Duplicates are rejected. Each name and
 * description has a documented length cap.
 *
 * Errors short-circuit: returns the first failing line's 1-based index.
 */

import type { CreateAPIResourceScopeInput } from "@/lib/idp-admin-client";

export const SCOPE_NAME_MAX = 64;
export const SCOPE_DESC_MAX = 255;

export function parseScopeLines(
  raw: string | null | undefined
): { ok: true; scopes: CreateAPIResourceScopeInput[] } | { ok: false; reason: string } {
  if (!raw) return { ok: true, scopes: [] };
  const lines = raw.split(/\r?\n/);
  const scopes: CreateAPIResourceScopeInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const sepIdx = line.indexOf(":");
    let name = "";
    let description = "";
    if (sepIdx === -1) {
      name = line.trim();
    } else {
      name = line.slice(0, sepIdx).trim();
      description = line.slice(sepIdx + 1).trim();
    }
    if (name.length === 0) {
      return { ok: false, reason: `Line ${i + 1}: scope name is required.` };
    }
    if (name.length > SCOPE_NAME_MAX) {
      return {
        ok: false,
        reason: `Line ${i + 1}: scope name is too long (${SCOPE_NAME_MAX} character maximum).`,
      };
    }
    if (description.length > SCOPE_DESC_MAX) {
      return {
        ok: false,
        reason: `Line ${i + 1}: scope description is too long (${SCOPE_DESC_MAX} character maximum).`,
      };
    }
    if (seen.has(name)) {
      return { ok: false, reason: `Line ${i + 1}: duplicate scope "${name}".` };
    }
    seen.add(name);
    scopes.push({ name, description });
  }
  return { ok: true, scopes };
}
