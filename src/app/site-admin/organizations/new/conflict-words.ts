/**
 * Which field a 409 from organization create names, and its words. The code
 * is the 409 body's "error" (OSS-0913-C, owner Q-C2 a). Only codes that the
 * OSS contract has confirmed get an entry here; any other 409 (or one from a
 * binary that sends no code) keeps the domain words the form has always shown.
 */

export type OrgCreateField = "name" | "domain" | "admin_email";

const DOMAIN = {
  field: "domain",
  text: "An organization with this domain already exists.",
} as const;

/** The words for a 409 email_exists, wherever the console meets it (Invite user too). */
export const EMAIL_EXISTS_TEXT = "This email address already has an account. Use another address.";

// identuum-idp-oss d6072cf: 409 {"error":"domain_exists"|"slug_exists"|"email_exists"};
// email_exists comes only from a create that names an initial administrator.
const BY_CODE: Readonly<Record<string, { field: OrgCreateField; text: string }>> = {
  domain_exists: DOMAIN,
  slug_exists: {
    field: "name",
    text: "An organization with this name already exists. Choose another name.",
  },
  email_exists: {
    field: "admin_email",
    text: EMAIL_EXISTS_TEXT,
  },
};

export function orgCreateConflict(code: string | undefined): {
  field: OrgCreateField;
  text: string;
} {
  return (code !== undefined && Object.hasOwn(BY_CODE, code) && BY_CODE[code]) || DOMAIN;
}
