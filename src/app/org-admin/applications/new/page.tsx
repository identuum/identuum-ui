/**
 * Org-admin Create Application page.
 *
 * Server-rendered shell that hosts the CreateApplicationForm
 * client component. Auth + role are enforced by the parent
 * /org-admin layout guard. The page itself does NOT call
 * getServerSession (the server action re-validates the session on
 * every invocation as belt-and-suspenders).
 *
 * Tenant scope: the IDP injects `OrganizationID` from the actor's
 * session on POST /api/v1/clients when the actor is RoleOrgAdmin.
 * No form field carries an org id and no wire field carries one
 * either; tenant scope is server-enforced.
 *
 * SECURITY:
 *   - This page does not render any client_secret at any point.
 *     The secret lives inside the form's useActionState envelope
 *     after a successful submission and is discarded on navigation.
 *   - The page is intentionally minimal: heading + subtitle + form.
 *     A future "back to list" affordance lives inside the form's
 *     success panel.
 */
import { CreateApplicationForm } from "./create-application-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create application — Identuum Org Admin",
};

export default function CreateApplicationPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Create application
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Register a new OAuth client for your organization. The client secret is shown
          only once.
        </p>
      </div>

      <CreateApplicationForm />
    </div>
  );
}
