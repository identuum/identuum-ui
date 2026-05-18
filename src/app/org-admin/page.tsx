/**
 * Org-admin overview page.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT need to repeat the guard — the layout already redirected
 * or rendered the unavailable message if auth was missing or wrong.
 *
 * getServerSession() is called here only to retrieve user data for display.
 * Because it is wrapped with React's cache(), this call shares the validate
 * result with the layout's call and does not incur a second IdP fetch.
 */
import { getServerSession } from "@/lib/server-session";

export default async function OrgAdminPage() {
  // Layout has already validated auth. This call is deduplicated by cache().
  const session = await getServerSession();
  const userEmail = session?.user?.email ?? null;
  const orgId = session?.user?.organization_id ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Overview</h1>
        <p className="text-sm text-stone-500 mt-0.5">Organization administration</p>
      </div>

      {/* Identity */}
      <Section title="Identity">
        <InfoRow label="Signed in as" value={userEmail ?? "—"} mono={false} />
        <InfoRow label="Role" value="org_admin" mono />
        {orgId && <InfoRow label="Organization ID" value={orgId} mono />}
      </Section>

      {/* Placeholder section cards */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-3">
          Sections
        </p>
        <div className="grid grid-cols-2 gap-4">
          <a href="/org-admin/users" className="block group">
            <ActiveCard title="Users" description="View members of your organization." />
          </a>
          <PlaceholderCard
            title="Applications"
            description="Configure OAuth clients and API resources for this organization."
          />
          <PlaceholderCard
            title="Settings"
            description="Authentication policies, MFA requirements, and domain configuration."
          />
          <PlaceholderCard
            title="Audit"
            description="Review authentication events and administrative actions."
          />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</p>
      </div>
      <div className="divide-y divide-stone-100">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-stone-500">{label}</span>
      <span
        className={`text-sm text-sky-950 ${mono ? "font-mono bg-stone-100 px-2 py-0.5 rounded text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm p-5">
      <p className="text-sm font-semibold text-sky-950">{title}</p>
      <p className="text-xs text-stone-400 mt-1 leading-relaxed">{description}</p>
      <span className="mt-3 inline-block text-[10px] font-medium uppercase tracking-wide text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
        coming soon
      </span>
    </div>
  );
}

function ActiveCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white border border-sky-200 rounded-[1.5rem] shadow-sm p-5 group-hover:border-sky-400 group-hover:shadow-md transition-all">
      <p className="text-sm font-semibold text-sky-950">{title}</p>
      <p className="text-xs text-stone-400 mt-1 leading-relaxed">{description}</p>
      <span className="mt-3 inline-block text-[10px] font-medium uppercase tracking-wide text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
        open →
      </span>
    </div>
  );
}
