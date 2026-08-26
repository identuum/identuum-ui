/**
 * Read-only Settings sections landed by slice
 * identuum-20260530-org-admin-settings-readonly-tabs.
 *
 * Four sections mounted on /org-admin/settings BELOW the existing
 * Domains card: Identity providers / Webhooks / Roles / Scope
 * templates. Each section renders the operator-safe field set
 * returned by its wire helper; no mutation control is rendered.
 *
 * SECURITY (load-bearing — pinned by Vitest):
 *   - Identity providers section NEVER renders client_secret /
 *     private_key / signing_cert / SAML private material / raw
 *     metadata XML / token / authorization-header field. The
 *     backend mapper drops these at the wire layer; the helper's
 *     projection drops them again; the section reads ONLY the
 *     documented operator-safe fields.
 *   - Webhooks section NEVER renders the signing secret /
 *     Authorization header / secret query params / raw payload.
 *     The backend redacts the secret to "" via
 *     MapWebhookEndpointsRedacted; the helper's projection drops it
 *     entirely; the section reads only id / url / event_filters /
 *     enabled / created_at.
 *   - Roles and Scope templates sections render scope-name strings
 *     only; no scope value carries credential material.
 *   - No mutation control on any section (no <form>, no <button
 *     type="submit">, no Create / Edit / Delete affordance).
 */
import type { AuthorizationServerPageBoundary } from "@/lib/capability-affordances";
import type {
  ListOrganizationIdentityProvidersResult,
  ListOrganizationWebhooksResult,
  ListOrgRolesResult,
  ListScopeTemplatesResult,
} from "@/lib/idp-admin-client";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

// ── Identity providers section ─────────────────────────────────────────────

export function IdentityProvidersReadOnlySection({
  result,
}: {
  result: ListOrganizationIdentityProvidersResult;
}) {
  return (
    <Card
      headingId="identity-providers-heading"
      title="Identity providers"
      subtitle="Read-only view of configured SSO providers for your organization. Create / edit / delete and connection-test are not available from this page."
    >
      {!result.ok && result.forbidden && (
        <Forbidden body="Your session does not have permission to view identity providers." />
      )}
      {!result.ok && result.featureUnavailable && (
        <Unavailable body="Identity provider federation is a CE IDP capability. IDP OSS deployments show this boundary instead of treating the section as a Starter feature." />
      )}
      {!result.ok && !result.forbidden && !result.featureUnavailable && <ErrorBody />}
      {result.ok && result.identity_providers.length === 0 && (
        <EmptyBody body="No identity providers are configured for your organization." />
      )}
      {result.ok && result.identity_providers.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {result.identity_providers.map((p) => (
            <li key={p.id} className="px-6 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-semibold text-sky-950 truncate">{p.name}</p>
                <p className="text-[10px] text-stone-400 leading-tight">
                  Type: <span className="font-mono">{p.type}</span>
                  {p.slug && (
                    <>
                      {" · "}Slug: <span className="font-mono">{p.slug}</span>
                    </>
                  )}
                </p>
                <p className="text-[10px] text-stone-400 leading-tight">
                  Created {formatDate(p.created_at)} · Updated {formatDate(p.updated_at)}
                </p>
              </div>
              <div className="shrink-0">
                <StatusPill active={p.active} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Webhooks section ───────────────────────────────────────────────────────

export function WebhooksReadOnlySection({ result }: { result: ListOrganizationWebhooksResult }) {
  return (
    <Card
      headingId="webhooks-heading"
      title="Webhooks"
      subtitle="Read-only view of configured webhook endpoints for your organization. Create / delete / test-delivery are not available from this page. Webhook signing secrets are never displayed."
    >
      {!result.ok && result.forbidden && (
        <Forbidden body="Your session does not have permission to view webhooks." />
      )}
      {!result.ok && result.featureUnavailable && (
        <Unavailable body="Webhooks are a CE IDP capability. IDP OSS deployments show this boundary instead of treating the section as a Starter feature." />
      )}
      {!result.ok && !result.forbidden && !result.featureUnavailable && <ErrorBody />}
      {result.ok && result.items.length === 0 && (
        <EmptyBody body="No webhook endpoints are configured for your organization." />
      )}
      {result.ok && result.items.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {result.items.map((w) => (
            <li key={w.id} className="px-6 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-mono text-sky-950 break-all">{w.url}</p>
                {w.event_filters.length > 0 && (
                  <p className="text-[10px] text-stone-400 leading-tight">
                    Events:{" "}
                    {w.event_filters.map((e, i) => (
                      <span key={e}>
                        <span className="font-mono">{e}</span>
                        {i < w.event_filters.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </p>
                )}
                <p className="text-[10px] text-stone-400 leading-tight">
                  Created {formatDate(w.created_at)}
                </p>
              </div>
              <div className="shrink-0">
                <StatusPill active={w.enabled} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Roles section ──────────────────────────────────────────────────────────

export function OrgRolesReadOnlySection({ result }: { result: ListOrgRolesResult }) {
  return (
    <Card
      headingId="org-roles-heading"
      title="Roles"
      subtitle="Read-only view of roles defined for your organization. Role create / edit / delete and user-role assignment are not available from this page."
    >
      {!result.ok && result.forbidden && (
        <Forbidden body="Your session does not have permission to view organization roles." />
      )}
      {!result.ok && !result.forbidden && <ErrorBody />}
      {result.ok && result.roles.length === 0 && (
        <EmptyBody body="No custom roles are defined for your organization." />
      )}
      {result.ok && result.roles.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {result.roles.map((r) => (
            <li key={r.id} className="px-6 py-3 space-y-1">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-sky-950 truncate">{r.name}</p>
                  {r.description && (
                    <p className="text-[10px] text-stone-400 leading-tight">{r.description}</p>
                  )}
                </div>
                <p className="shrink-0 text-[10px] text-stone-400 whitespace-nowrap">
                  {r.scopes.length} scope{r.scopes.length === 1 ? "" : "s"}
                </p>
              </div>
              {r.scopes.length > 0 && r.scopes.length <= 12 && (
                <p className="text-[10px] text-stone-500 leading-tight">
                  {r.scopes.map((s, i) => (
                    <span key={s} className="font-mono">
                      {s}
                      {i < r.scopes.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Scope templates section ────────────────────────────────────────────────

export function ScopeTemplatesReadOnlySection({
  capabilityBoundary,
  result,
}: {
  capabilityBoundary?: AuthorizationServerPageBoundary | null;
  result: ListScopeTemplatesResult | null;
}) {
  return (
    <Card
      headingId="scope-templates-heading"
      title="Scope templates"
      subtitle="Read-only view of scope templates available for your organization. Create / edit / delete are not available from this page."
    >
      {capabilityBoundary && <Unavailable body={capabilityBoundary.body} />}
      {!capabilityBoundary && result && !result.ok && result.forbidden && (
        <Forbidden body="Your session does not have permission to view scope templates." />
      )}
      {!capabilityBoundary && result && !result.ok && result.featureUnavailable && (
        <Unavailable body="Scope templates are part of the OSS/Starter Authorization Server surface when the backend exposes it. This IDP backend did not make the endpoint available." />
      )}
      {!capabilityBoundary &&
        result &&
        !result.ok &&
        !result.forbidden &&
        !result.featureUnavailable && <ErrorBody />}
      {!capabilityBoundary && result?.ok && result.templates.length === 0 && (
        <EmptyBody body="No scope templates are available for your organization." />
      )}
      {!capabilityBoundary && result?.ok && result.templates.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {result.templates.map((t) => (
            <li key={t.id} className="px-6 py-3 space-y-1">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-sky-950 truncate">{t.name}</p>
                  {t.description && (
                    <p className="text-[10px] text-stone-400 leading-tight">{t.description}</p>
                  )}
                </div>
                <p className="shrink-0 text-[10px] text-stone-400 whitespace-nowrap">
                  {t.scopes.length} scope{t.scopes.length === 1 ? "" : "s"}
                </p>
              </div>
              {t.scopes.length > 0 && t.scopes.length <= 12 && (
                <p className="text-[10px] text-stone-500 leading-tight">
                  {t.scopes.map((s, i) => (
                    <span key={s} className="font-mono">
                      {s}
                      {i < t.scopes.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Card({
  headingId,
  title,
  subtitle,
  children,
}: {
  headingId: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id={headingId} className="text-sm font-semibold text-sky-950">
          {title}
        </h2>
        <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 border border-stone-200 px-2.5 py-0.5 text-[10px] font-semibold text-stone-500">
      disabled
    </span>
  );
}

function EmptyBody({ body }: { body: string }) {
  return (
    <div className="px-6 py-5">
      <p className="text-xs text-stone-500 leading-relaxed">{body}</p>
    </div>
  );
}

function Unavailable({ body }: { body: string }) {
  return (
    <div className="px-6 py-5">
      <p className="text-xs text-stone-500 leading-relaxed">{body}</p>
    </div>
  );
}

function Forbidden({ body }: { body: string }) {
  return (
    <div className="px-6 py-5">
      <p className="text-xs text-stone-500 leading-relaxed">{body}</p>
    </div>
  );
}

function ErrorBody() {
  return (
    <div className="px-6 py-5">
      <p className="text-xs text-stone-500 leading-relaxed">
        Could not load this section. Reload the page or try again later.
      </p>
    </div>
  );
}

// ── Organization record section (read-only — THE-V032-ALL-GREEN ruling C) ──
//
// AdminPermissionsModel.md pins org_admin to "day-to-day control of that
// organization's resources (users, clients, service accounts, identity
// provider, protocol settings, domains, RBAC roles)" and explicitly outside
// "organization lifecycle (create/delete/activate -- infrastructure
// authority)". The ORG RECORD itself — display name, security policy,
// registration policy — is not among the seven areas, and the backend
// correctly refuses org_admin writes to it (PUT /organizations/:id is
// infrastructure authority). This section therefore PRESENTS the record
// read-only instead of rendering save affordances that must always fail.
//
// COPY RULE: the settings page body-scan bans authority language
// ("site admin", "cross-org", …) — the copy below says "platform
// administrator", matching the page's established error copy.
export function OrgRecordReadOnlySection({
  name,
  domain,
  mfaPolicy,
  invitePolicyLabel,
  invitePolicyDescription,
}: {
  name: string;
  domain: string | null | undefined;
  mfaPolicy: string;
  invitePolicyLabel: string;
  invitePolicyDescription: string;
}) {
  return (
    <Card
      headingId="organization-record-heading"
      title="Organization record"
      subtitle="Read-only. The organization record (display name, security policy, registration policy) is managed at the infrastructure level — contact your platform administrator to change it."
    >
      <dl className="px-6 py-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-xs font-medium text-stone-500">Organization name</dt>
          <dd className="text-sm text-sky-950 text-right">{name}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-xs font-medium text-stone-500">Primary domain</dt>
          <dd className="text-sm font-mono text-sky-950 text-right">{domain ?? "—"}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-xs font-medium text-stone-500">MFA policy</dt>
          <dd className="text-sm text-sky-950 text-right">
            {mfaPolicy === "required" ? "Required" : "Optional"}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-xs font-medium text-stone-500">Invite policy</dt>
          <dd className="text-right">
            <p className="text-sm text-sky-950">{invitePolicyLabel}</p>
            <p className="text-[11px] text-stone-400 leading-snug max-w-md">
              {invitePolicyDescription}
            </p>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
