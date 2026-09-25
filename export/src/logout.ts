import { BFF_LOGOUT_PATH, bff, readJson } from "./bff";

// Leave the server's five-second revocation bound time to answer, but also
// bound the browser-to-server transport. Aborting confirms no logout outcome.
const LOGOUT_REQUEST_TIMEOUT_MS = 6000;

export async function signOutDestination(): Promise<string> {
  let res: Response;
  try {
    res = await bff(BFF_LOGOUT_PATH, {
      method: "POST",
      signal: AbortSignal.timeout(LOGOUT_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return "/login?reason=sign_out_unconfirmed";
  }
  if (res.status === 204) {
    return "/login?reason=signed_out";
  }
  const body = await readJson(res);
  if (res.ok && body?.logout === "local_only") {
    return "/login?reason=signed_out_locally";
  }
  // A cookie-session edition (identuum-idp-ce) confirms its revocation in
  // the body rather than with a 204.
  if (res.ok && body?.logged_out === true) {
    return "/login?reason=signed_out";
  }
  return "/login?reason=sign_out_unconfirmed";
}
