/**
 * IdP same-origin proxy path constants.
 *
 * No browser APIs here — safe to import in both server components and
 * client components. Both idp-client.ts (browser) and layout files
 * (server) import from this module so the paths have a single source.
 */
export const IDP_PATHS = {
  orgLookup: "/api/idp/api/v1/auth/organization-lookup",
  login: "/api/idp/api/v1/auth/login",
  mfaLogin: "/api/idp/api/v1/auth/login/mfa",
  mfaEnrollInitiate: "/api/idp/api/v1/auth/login/mfa/enroll/initiate",
  mfaEnrollComplete: "/api/idp/api/v1/auth/login/mfa/enroll/complete",
  validate: "/api/idp/api/v1/validate",
  logout: "/api/idp/api/v1/logout",
  // WebAuthn / passkey self-service enrollment and management (authenticated user only)
  webauthnRegisterBegin: "/api/idp/api/v1/webauthn/register/begin",
  webauthnRegisterFinish: "/api/idp/api/v1/webauthn/register/finish",
  webauthnCredentials: "/api/idp/api/v1/webauthn/credentials",
  // PATCH /credentials/:id — rename (same base URL, :id appended at call site)
  // WebAuthn / passkey login (public, unauthenticated)
  webauthnLoginBegin: "/api/idp/api/v1/auth/login/webauthn/begin",
  webauthnLoginFinish: "/api/idp/api/v1/auth/login/webauthn/finish",
} as const;
