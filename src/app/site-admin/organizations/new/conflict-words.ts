/**
 * Which field a 409 from organization create names, and its words. The code
 * is the 409 body's "error" (OSS-0913-C, owner Q-C2 a). Only codes that the
 * OSS contract has confirmed get an entry here; any other 409 keeps the
 * domain words the form has always shown.
 */

export type OrgCreateField = "name" | "domain" | "admin_email";

const BY_CODE: Readonly<Record<string, { field: OrgCreateField; text: string }>> = {};

const DOMAIN = {
  field: "domain",
  text: "An organization with this domain already exists.",
} as const;

export function orgCreateConflict(code: string | undefined): {
  field: OrgCreateField;
  text: string;
} {
  return (code !== undefined && Object.hasOwn(BY_CODE, code) && BY_CODE[code]) || DOMAIN;
}
