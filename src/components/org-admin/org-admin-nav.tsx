"use client";

import { usePathname } from "next/navigation";

interface NavLink {
  label: string;
  href: string;
  /** "exact" = only active on this exact path; "prefix" = active on this path and children */
  match: "exact" | "prefix";
}

const NAV_LINKS: NavLink[] = [
  { label: "Overview", href: "/org-admin", match: "exact" },
  { label: "Users", href: "/org-admin/users", match: "prefix" },
  { label: "Audit", href: "/org-admin/audit", match: "prefix" },
  { label: "Settings", href: "/org-admin/settings", match: "prefix" },
  { label: "Applications", href: "/org-admin/applications", match: "prefix" },
];

// Promoted Applications from disabled-"soon" → active nav in
// identuum-20260530-org-admin-applications-surface-discovery-and-foundation.
// Future "Coming soon" sidebar items would re-populate this array.
const DISABLED_LABELS: string[] = [];

export function OrgAdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5">
      {NAV_LINKS.map((item) => {
        const active =
          item.match === "exact" ? pathname === item.href : pathname.startsWith(item.href);
        return active ? (
          <NavItemActive key={item.href} href={item.href} label={item.label} />
        ) : (
          <NavItemLink key={item.href} href={item.href} label={item.label} />
        );
      })}
      {DISABLED_LABELS.map((label) => (
        <NavItemDisabled key={label} label={label} />
      ))}
    </nav>
  );
}

function NavItemActive({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center rounded-lg px-3 py-2 text-sm font-medium text-white bg-sky-800/50"
      aria-current="page"
    >
      {label}
    </a>
  );
}

function NavItemLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
    >
      {label}
    </a>
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
