import type { OrgClientItem } from "@/lib/types";

/**
 * CE-UI-5c: a client the IdP reports disabled (identuum-idp-ce: a public or
 * service-account client the OSS upgrade carried in disabled) cannot sign
 * anyone in, so editing it or rotating its secret does not apply. An IdP that
 * omits `disabled` (identuum-idp-oss) reads as enabled.
 */
export function clientActionsApply(client: Pick<OrgClientItem, "disabled">): boolean {
  return client.disabled !== true;
}

export function ClientStatusBadge({ disabled }: { disabled?: boolean }) {
  if (disabled !== true) return null;
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded text-rose-700 bg-rose-100">
      Disabled
    </span>
  );
}
