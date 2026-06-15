/**
 * Pure parser for the bulk-invite textarea.
 *
 * Lives in its own module (NOT the "use server" actions file) so it can be
 * synchronously exported AND unit-tested without next-server's "every
 * export must be async" constraint. The server action delegates to this
 * parser before issuing the wire call.
 *
 * Accepted row shapes (one per line):
 *   - "email,Display Name"   (CSV — preferred)
 *   - "email\tDisplay Name"  (tab-separated, e.g. pasted from a spreadsheet)
 *
 * Single-column "email" lines are rejected: the IDP backend requires both
 * fields per row, so silently allowing email-only rows would produce a
 * confusing 400. Blank lines are stripped. Emails are lowercased + trimmed.
 *
 * Errors short-circuit: returns the first failing line's 1-based index so
 * the operator can locate it.
 */

import type { BulkUserEntry } from "@/lib/idp-admin-client";

const BULK_EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parseBulkInviteEntries(
  raw: string
): { ok: true; entries: BulkUserEntry[] } | { ok: false; reason: string } {
  const lines = raw.split(/\r?\n/);
  const entries: BulkUserEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const sepIdx = line.search(/[,\t]/);
    if (sepIdx <= 0) {
      return {
        ok: false,
        reason: `Line ${i + 1}: expected "email,Display Name" (comma- or tab-separated).`,
      };
    }
    const email = line.slice(0, sepIdx).trim().toLowerCase();
    const name = line.slice(sepIdx + 1).trim();
    if (!BULK_EMAIL_RE.test(email)) {
      return { ok: false, reason: `Line ${i + 1}: invalid email "${email}".` };
    }
    if (name.length === 0) {
      return { ok: false, reason: `Line ${i + 1}: display name is required.` };
    }
    entries.push({ email, name });
  }
  if (entries.length === 0) {
    return { ok: false, reason: "Paste at least one row." };
  }
  if (entries.length > 50) {
    return {
      ok: false,
      reason: `Maximum 50 rows per batch (got ${entries.length}).`,
    };
  }
  return { ok: true, entries };
}
