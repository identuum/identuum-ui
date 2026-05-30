/**
 * Org-admin Edit Application page.
 *
 * Server-rendered. Auth + role are enforced by the parent /org-admin
 * layout guard. The page itself does NOT call getServerSession (the
 * `updateApplicationAction` server action re-validates the session on
 * every submission as belt-and-suspenders).
 *
 * Behaviour:
 *   - Pre-flight UUID-shape regex avoids a wire round-trip on
 *     obviously bad path segments — same gate as the detail page.
 *   - Calls getOrganizationClientById(id) to fetch the current safe
 *     field values. Tenant scope is server-enforced by the IDP — an
 *     org_admin requesting a client outside their own organization
 *     gets 403.
 *   - Renders four error branches: invalid UUID + result.invalid both
 *     render NotFoundPanel; result.notFound renders NotFoundPanel;
 *     result.forbidden renders ForbiddenPanel; the fallthrough renders
 *     ErrorPanel.
 *   - On success, mounts EditApplicationForm pre-filled with the
 *     fetched values.
 *
 * Security:
 *   - The page NEVER renders, requests, or displays a `client_secret`.
 *     The page source does not reference the literal anywhere.
 *   - There is no Delete / Regenerate / Rotate affordance on this
 *     surface. The form supports updating Name / Redirect URIs /
 *     Post-logout redirect URIs / Allowed audiences / Default scope
 *     only — every other client field is intentionally not editable.
 *   - Breadcrumb-style "← Back to application details" link sits at
 *     the top so the operator can navigate out without using the
 *     browser back button.
 */
import { getOrganizationClientById } from "@/lib/idp-admin-client";
import type { Metadata } from "next";
import { EditApplicationForm } from "./edit-application-form";

export const metadata: Metadata = {
  title: "Edit application — Identuum Org Admin",
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function OrgAdminApplicationEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return (
      <ShellWithBack id={id}>
        <NotFoundPanel />
      </ShellWithBack>
    );
  }

  const result = await getOrganizationClientById(id);

  if (!result.ok) {
    if (result.notFound)
      return (
        <ShellWithBack id={id}>
          <NotFoundPanel />
        </ShellWithBack>
      );
    if (result.forbidden)
      return (
        <ShellWithBack id={id}>
          <ForbiddenPanel />
        </ShellWithBack>
      );
    if (result.invalid)
      return (
        <ShellWithBack id={id}>
          <NotFoundPanel />
        </ShellWithBack>
      );
    return (
      <ShellWithBack id={id}>
        <ErrorPanel />
      </ShellWithBack>
    );
  }

  const client = result.data;
  return (
    <ShellWithBack id={id}>
      <Header name={client.name} />
      <EditApplicationForm
        clientId={id}
        initialName={client.name}
        initialClientID={client.client_id}
        initialIsPublic={client.is_public}
        initialAuthMethod={client.token_endpoint_auth_method}
        initialRedirectURIs={client.redirect_uris}
        initialPostLogoutRedirectURIs={client.post_logout_redirect_uris}
        initialAllowedAudiences={client.allowed_audiences}
        initialScope={client.scope}
      />
    </ShellWithBack>
  );
}

function ShellWithBack({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href={`/org-admin/applications/${encodeURIComponent(id)}`}
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to application details
      </a>
      {children}
    </div>
  );
}

function Header({ name }: { name: string }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 truncate">
        Edit {name}
      </h1>
      <p className="text-sm text-stone-500 mt-0.5">
        Update the operator-safe configuration for this OAuth client. Secret rotation
        and Public/Confidential type changes are not available from this page.
      </p>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Application not found</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The application you tried to edit does not exist or has been removed. Use the
        back link above to return to the application details.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        You do not have permission to edit this application. Only applications
        registered in your organization can be edited here.
      </p>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load application</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the
        problem persists.
      </p>
    </div>
  );
}
