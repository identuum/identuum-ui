/**
 * The harness appliance's addresses (owner ruling t, 2026-10-07).
 *
 * e2e-full/scripts/full-run.sh is their one source: it sets E2E_APP_PORT,
 * starts the appliance on it and exports these two variables to every phase.
 * A spec never falls back to a port of its own — a default here once pointed
 * the suite at whatever answered on the dev stack's port — so a run without
 * them fails at once, naming the variable.
 */
function harnessEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set: e2e-full specs run only through e2e-full/scripts/full-run.sh, which sets it from E2E_APP_PORT`
    );
  }
  return value;
}

/** The appliance's API base, e.g. http://127.0.0.1:<E2E_APP_PORT>. */
export function harnessIdpBase(): string {
  return harnessEnv("IDENTUUM_E2E_FULL_IDP_BASE");
}

/** The appliance's own browser origin (its issuer), e.g. http://localhost:<E2E_APP_PORT>. */
export function harnessIdpOrigin(): string {
  return harnessEnv("IDENTUUM_E2E_FULL_IDP_ORIGIN");
}
