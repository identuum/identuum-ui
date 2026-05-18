/**
 * Site-admin overview page.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * This page does NOT need to repeat the guard — the layout already redirected
 * or rendered the unavailable message if auth was missing or wrong.
 *
 * getServerSession() is called here only to retrieve user data for display.
 * Because it is wrapped with React's cache(), this call shares the validate
 * result with the layout's call and does not incur a second IdP fetch.
 */
import { getServerSession } from "@/lib/server-session";
import { SiteAdminOverviewClient } from "./client";

export default async function SiteAdminPage() {
  // Layout has already validated auth. This call is deduplicated by cache().
  const session = await getServerSession();

  return (
    <SiteAdminOverviewClient
      initialUser={session?.user ?? null}
      initialRole={session?.user?.role ?? session?.role ?? null}
    />
  );
}
