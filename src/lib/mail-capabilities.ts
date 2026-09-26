/**
 * CE-UI-2b (owner decision 2026-09-26, wiki platform/ce-mail-ceremonies.md
 * option B): what the IdP can do by mail, from GET /api/v1/component.
 *
 * - `mail_ceremonies`: the reset, verification and activation mails can be
 *   delivered. false on identuum-idp-ce (it sends no mail) and on
 *   identuum-idp-oss without SMTP. A binary that does not report the key is
 *   treated as able, as before the key existed.
 * - `admin_reset_link`: an org_admin can issue a one-time reset link for a
 *   user of its organization (identuum-idp-ce). Only an explicit true offers
 *   it.
 */
import { getServerRuntimeState } from "@/lib/server-runtime-state";

export async function mailCeremoniesAvailable(): Promise<boolean> {
  const state = await getServerRuntimeState();
  return state?.components.idp?.capabilities?.mail_ceremonies !== false;
}

export async function adminResetLinkAvailable(): Promise<boolean> {
  const state = await getServerRuntimeState();
  return state?.components.idp?.capabilities?.admin_reset_link === true;
}
