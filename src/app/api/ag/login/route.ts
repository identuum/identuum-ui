/**
 * AG operator login endpoint.
 *
 * Accepts { email, password } JSON, forwards to AG's POST /login on the
 * identity surface, and sets an HttpOnly ag_access_token cookie on success.
 *
 * The raw access_token from AG is NEVER returned to the browser — it is
 * consumed server-side and stored only as an HttpOnly cookie.
 *
 * Security:
 *   - Bearer token is stored in HttpOnly cookie — not accessible to JS.
 *   - Internal AG URL is never exposed in the response.
 *   - Credentials are proxied server-to-server; the browser never calls AG.
 *   - The token value is not logged.
 */
import { AG_COOKIE_NAME } from "@/lib/ag-client";
import { agIdentityBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = loadRuntimeConfig();

  if (!cfg?.ag.enabled) {
    return NextResponse.json(
      { ok: false, error: "AG is not enabled in this deployment." },
      { status: 503 }
    );
  }

  let email: string;
  let password: string;
  try {
    const body = (await req.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
    }
    email = body.email.trim();
    password = body.password;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 }
    );
  }

  const agIdentityUrl = agIdentityBaseUrl(cfg).replace(/\/$/, "");

  let agRes: Response;
  try {
    agRes = await fetch(`${agIdentityUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach AG identity surface. Check configuration." },
      { status: 502 }
    );
  }

  if (!agRes.ok) {
    // Surface a generic error — do not leak AG internal error details.
    return NextResponse.json(
      { ok: false, error: "Invalid credentials." },
      { status: agRes.status === 401 ? 401 : 502 }
    );
  }

  let agBody: { access_token?: unknown; expires_in?: unknown };
  try {
    agBody = (await agRes.json()) as typeof agBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Unexpected AG response." }, { status: 502 });
  }

  const token = agBody.access_token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ ok: false, error: "AG did not return a token." }, { status: 502 });
  }

  const expiresIn =
    typeof agBody.expires_in === "number" && agBody.expires_in > 0 ? agBody.expires_in : 3600;

  // Set HttpOnly cookie — token is NOT returned in the response body.
  const cookieStore = await cookies();
  cookieStore.set(AG_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: expiresIn,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
