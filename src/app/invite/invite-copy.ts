/** Where a redeemed invite lands: sign-in, with the invite_accepted notice. */
export const INVITE_ACCEPTED_LOGIN = "/login?notice=invite_accepted";

/** One answer for an unknown, expired or spent link, as the IdP gives one. */
export const INVITE_INVALID_COPY =
  "This invitation link is no longer valid: it was used, it expired, or a newer one replaced it. Ask your administrator for a new one.";

/** The IdP limits these calls like sign-in (429). */
export const INVITE_RATE_LIMITED_COPY =
  "Too many attempts from this network. Wait a minute, then try again.";
