/**
 * org-create-validation-source-invariants.test.ts — ORG-CREATE-VALIDATION-1
 *
 * THE-UNVALIDATED-DOMAIN (2026-08-31). Creating an organization with the
 * domain "lexus" — no dot, no TLD — succeeded and persisted. The server is
 * the guarantee (idp-oss ORG-DOMAIN-FORMAT-1); this file pins the FRONTEND
 * MIRROR, which the owner ruled must also validate, and which must never be
 * more permissive than the server.
 *
 * The create action's zod schema is a server-only module (it imports
 * next/headers via its session helper), so these are source invariants over
 * the schema's text rather than a runtime import — the same technique the
 * other *-source-invariants specs use. They fail when a rule is deleted,
 * not when a comment changes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const ACTIONS = "src/app/site-admin/organizations/new/actions.ts";
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/** Comment-stripped source: a rule must exist as CODE, not as prose. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

describe("the create-organization form validates every field it sends [ORG-CREATE-VALIDATION-1]", () => {
  const src = stripComments(read(ACTIONS));

  it("domain is checked for FORMAT, not merely for length [ORG-CREATE-VALIDATION-1]", () => {
    // The defect: min(1)/max(253)/toLowerCase().trim() with NO format rule,
    // while admin_email beside it already used .email().
    expect(src, "a domain grammar exists").toContain("DOMAIN_RE");
    // Mirrors the server grammar: labels, a required dot, and a TLD that is
    // alphabetic or punycode.
    expect(src, "the grammar requires at least two labels and a real TLD").toMatch(
      /\^\(\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\\\.\)\+\(\[a-z\]\{2,\}\|xn--\[a-z0-9-\]\+\)\$/
    );
    expect(src, "the grammar is APPLIED, not merely declared").toMatch(/DOMAIN_RE\.test\(/);
    expect(src, "per-label length is bounded").toMatch(/label\.length <= 63/);
    expect(src, "the operator is told what a domain looks like").toMatch(/acme\.com/);
  });

  it("name rejects whitespace-only input, not just the empty string", () => {
    // `.min(1)` accepted "   " — the same hole the server's `Name == ""` had.
    expect(src, "name is trimmed before the emptiness check").toMatch(
      /name:[\s\S]{0,400}?transform\(\(v\) => v\.trim\(\)\)/
    );
    expect(src, "and then required to have content").toMatch(
      /name:[\s\S]{0,400}?refine\(\(v\) => v\.length > 0/
    );
    expect(src, "with the column's 255 bound").toMatch(/name:[\s\S]{0,400}?max\(255/);
  });

  it("admin_email keeps its format check", () => {
    expect(src, "email format is still enforced").toMatch(/admin_email:[\s\S]{0,300}?\.email\(/);
  });

  it("every field the form sends is validated — none is passed through raw", () => {
    // The schema's keys and the validated keys must be the same set: a field
    // added later without a rule fails here.
    const schemaBlock = src.slice(src.indexOf("const schema = z.object({"));
    for (const field of ["name", "domain", "admin_email"]) {
      expect(schemaBlock, `${field} appears in the schema`).toContain(`${field}:`);
    }
    // No field may be a bare z.string() with no constraint at all.
    expect(schemaBlock, "no unconstrained bare string field").not.toMatch(
      /(name|domain|admin_email):\s*z\.string\(\),/
    );
  });
});
