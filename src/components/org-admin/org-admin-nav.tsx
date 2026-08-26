"use client";

import { usePathname } from "next/navigation";
import {
  type CapabilityAffordance,
  getCapabilityAffordance,
  getPrimaryNavCapabilityDecision,
  type PrimaryNavUnavailableBehavior,
} from "@/lib/capability-affordances";
import type { ComponentCapabilities } from "@/lib/types";

interface NavLink {
  label: string;
  href: string;
  /** "exact" = only active on this exact path; "prefix" = active on this path and children */
  match: "exact" | "prefix";
  capability?: keyof ComponentCapabilities;
  boundary?: "enterprise_ce";
  primaryNavUnavailableBehavior?: PrimaryNavUnavailableBehavior;
}

export const ORG_ADMIN_NAV_LINKS: NavLink[] = [
  { label: "Overview", href: "/org-admin", match: "exact" },
  { label: "Users", href: "/org-admin/users", match: "prefix" },
  {
    label: "Audit",
    href: "/org-admin/audit",
    match: "prefix",
    capability: "audit_log",
    boundary: "enterprise_ce",
  },
  { label: "Settings", href: "/org-admin/settings", match: "prefix" },
  {
    label: "Applications",
    href: "/org-admin/applications",
    match: "prefix",
    capability: "oauth_clients",
    primaryNavUnavailableBehavior: "hide",
  },
  {
    label: "API resources",
    href: "/org-admin/api-resources",
    match: "prefix",
    capability: "api_resources",
    primaryNavUnavailableBehavior: "hide",
  },
  {
    label: "Service accounts",
    href: "/org-admin/service-accounts",
    match: "prefix",
    capability: "service_accounts",
    primaryNavUnavailableBehavior: "hide",
  },
];

// Promoted Applications from disabled-"soon" → active nav in
// identuum-20260530-org-admin-applications-surface-discovery-and-foundation.
// Future "Coming soon" sidebar items would re-populate this array.
const DISABLED_LABELS: string[] = [];

export function OrgAdminNav({ capabilities }: { capabilities?: ComponentCapabilities | null }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5">
      {ORG_ADMIN_NAV_LINKS.map((item) => {
        const navDecision = item.capability
          ? getPrimaryNavCapabilityDecision({
              capabilities,
              key: item.capability,
              unavailableBehavior: item.primaryNavUnavailableBehavior,
            })
          : null;
        if (navDecision && !navDecision.visible) return null;
        const active =
          item.match === "exact" ? pathname === item.href : pathname.startsWith(item.href);
        const affordance = item.capability
          ? getCapabilityAffordance({
              capabilities,
              key: item.capability,
              boundary: item.boundary,
            })
          : null;
        return active ? (
          <NavItemActive
            key={item.href}
            href={item.href}
            label={item.label}
            affordance={affordance}
          />
        ) : (
          <NavItemLink
            key={item.href}
            href={item.href}
            label={item.label}
            affordance={affordance}
          />
        );
      })}
      {DISABLED_LABELS.map((label) => (
        <NavItemDisabled key={label} label={label} />
      ))}
    </nav>
  );
}

function NavItemActive({
  href,
  label,
  affordance,
}: {
  href: string;
  label: string;
  affordance: CapabilityAffordance | null;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white bg-sky-800/50"
      aria-current="page"
    >
      <span className="truncate">{label}</span>
      {affordance && <CapabilityBadge affordance={affordance} />}
    </a>
  );
}

function NavItemLink({
  href,
  label,
  affordance,
}: {
  href: string;
  label: string;
  affordance: CapabilityAffordance | null;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
    >
      <span className="truncate">{label}</span>
      {affordance && <CapabilityBadge affordance={affordance} />}
    </a>
  );
}

function CapabilityBadge({ affordance }: { affordance: CapabilityAffordance }) {
  const className =
    affordance.state === "available"
      ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
      : affordance.state === "unavailable"
        ? "border-stone-400/40 bg-stone-400/10 text-stone-300"
        : affordance.state === "unknown"
          ? "border-sky-300/40 bg-sky-300/10 text-sky-200"
          : "border-amber-300/40 bg-amber-300/10 text-amber-200";

  return (
    // Decorative capability-status pill. aria-hidden keeps it OUT of the parent
    // nav link's accessible name (which must remain the destination, e.g.
    // "Service accounts", not "Service accounts Available") — the visible badge
    // and any getByText assertions are unaffected.
    <span
      aria-hidden="true"
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${className}`}
    >
      {affordance.label}
    </span>
  );
}

function NavItemDisabled({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-sky-800 cursor-default select-none">
      {label}
      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-900 bg-sky-950 px-1.5 py-0.5 rounded">
        soon
      </span>
    </span>
  );
}
