/**
 * UI-side logout handler.
 *
 * Accepts a POST, forwards the session cookie to the IdP logout endpoint
 * (server-side, using internal_base_url when configured), and redirects the
 * browser to /login regardless of the IdP response.
 *
 * Using a UI route instead of a direct form POST to /api/idp/api/v1/logout
 * allows the browser to receive a proper 302 redirect to /login rather than
 * displaying the IdP's JSON response body.
 *
 * Tokens remain cookie-only. This route forwards cookies server-side and
 * never exposes them to JavaScript.
 */
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (cfg?.idp.enabled) {
    // Forward session cookies to the IdP logout endpoint server-side.
    // We do not wait for success — a failed logout still clears browser cookies
    // (the IdP cookie will expire naturally or the session invalidation may be
    // partial). Redirecting to /login is always the right next step.
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    try {
      await fetch(`${idpBaseUrl(cfg)}/api/v1/logout`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
        cache: "no-store",
      });
    } catch {
      // Best-effort: network failure during logout should not prevent redirect.
    }
  }

  // Always redirect to login after logout, regardless of IdP response.
  redirect("/login");
}
