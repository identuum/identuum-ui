/**
 * AG operator logout endpoint.
 *
 * Clears the ag_operator_session cookie and redirects to /ag-admin/login.
 * No AG backend call is made — the cookie deletion is sufficient for
 * the UI session; the AG token will expire naturally.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AG_COOKIE_NAME } from "@/lib/ag-client";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.delete(AG_COOKIE_NAME);
  redirect("/ag-admin/login");
}
