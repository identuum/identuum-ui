/**
 * AG governance authenticated route group layout.
 *
 * Enforces AG operator session: redirects to /ag-admin/login when the
 * ag_access_token cookie is absent. The /ag-admin/login page sits OUTSIDE
 * this route group and is therefore reachable without a session.
 *
 * Token presence is checked here; validity is enforced by the AG backend
 * on each API call (401 = expired/revoked; caller redirects to login).
 *
 * Security: no token value or credential is passed to client components.
 */
import { hasAgSession } from "@/lib/ag-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgAdminAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = await hasAgSession();
  if (!authenticated) {
    redirect("/ag-admin/login");
  }

  return <>{children}</>;
}
