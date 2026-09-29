/**
 * AuditActorCell / AuditOrganizationCell (OSS-FIN-3) — who acted, and which
 * organization a row concerns.
 *
 * The actor reads its type (user, service_account, client, setup_token,
 * system, anonymous) with the best identifier the row carries: the email, else
 * a client's client_id (metadata.actor_client_id), else a short id; the role
 * follows when present. The organization is the one acted upon
 * (organization_id), named when the page knows the name, else a short id;
 * "Platform" when the row concerns none.
 */
import type { AuditEventItem } from "@/lib/idp-admin-client";
import { AuditIdentityCell } from "./audit-identity-cell";

const TYPE_LABEL: Record<string, string> = {
  user: "User",
  service_account: "Service account",
  client: "Client",
  setup_token: "Setup token",
  system: "System",
  anonymous: "Anonymous",
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function actorTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? (type || "Unknown");
}

export function AuditActorCell({ event }: { event: AuditEventItem }) {
  const clientId =
    typeof event.metadata?.actor_client_id === "string" ? event.metadata.actor_client_id : null;
  return (
    <div className="space-y-0.5" data-actor-type={event.actor_type || "unknown"}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        {actorTypeLabel(event.actor_type)}
        {event.actor_role ? ` · ${event.actor_role}` : ""}
      </span>
      {event.actor_email ? (
        <AuditIdentityCell value={event.actor_email} fallback={null} />
      ) : clientId ? (
        <span className="block text-xs font-mono text-sky-950 truncate" title={clientId}>
          {clientId}
        </span>
      ) : event.actor_id ? (
        <span className="block text-xs font-mono text-stone-500" title={event.actor_id}>
          {shortId(event.actor_id)}
        </span>
      ) : null}
    </div>
  );
}

export function AuditOrganizationCell({
  event,
  names,
}: {
  event: AuditEventItem;
  /** Organization id → name, when the page has it. */
  names?: Record<string, string>;
}) {
  const id = event.organization_id;
  if (!id) {
    return <span className="text-xs text-stone-400">Platform</span>;
  }
  const name = names?.[id];
  return (
    <span
      className={`block text-xs truncate ${name ? "text-sky-950" : "font-mono text-stone-500"}`}
      title={id}
      data-organization-id={id}
    >
      {name ?? shortId(id)}
    </span>
  );
}
