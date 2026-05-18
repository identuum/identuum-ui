/**
 * Create organization page — site_admin only.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * The server action (actions.ts) independently re-validates site_admin before
 * calling the IdP.
 *
 * This page is intentionally read-only for the form render. All mutation
 * logic is in the server action; no state is mutated server-side during GET.
 */
import type { Metadata } from "next";
import { CreateOrgForm } from "./form-client";

export const metadata: Metadata = { title: "New Organization — Identuum Admin" };

export default function NewOrganizationPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400 mb-1">
        <a href="/site-admin/organizations" className="hover:text-sky-950 transition-colors">
          Organizations
        </a>
        <span>/</span>
        <span>New</span>
      </div>

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Create organization</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Creates a new tenant organization. Only name and domain are required. Other settings can
          be configured after creation.
        </p>
      </div>

      {/* Form card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-6 shadow-sm">
        <CreateOrgForm />
      </div>

      {/* Informational notes */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-5 shadow-sm space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Notes</p>
        <ul className="text-xs text-stone-500 space-y-1 list-disc list-inside leading-relaxed">
          <li>
            New organizations are <span className="font-medium text-sky-950">inactive</span> until
            an admin claims them via the activation link.
          </li>
          <li>
            If no admin email is provided, a{" "}
            <span className="font-medium text-sky-950">shell organization</span> is created. An
            admin can be assigned later.
          </li>
          <li>Domain names are stored in lowercase and must be unique across all organizations.</li>
          <li>
            The URL slug is auto-generated from the name. Custom slugs are not configurable from
            this form.
          </li>
        </ul>
      </div>
    </div>
  );
}
