"use client";

import { usePathname } from "next/navigation";

interface NavLink {
  label: string;
  href: string;
  match: "exact" | "prefix";
}

const NAV_LINKS: NavLink[] = [
  { label: "Overview", href: "/ag-admin", match: "exact" },
  { label: "Agent Registry", href: "/ag-admin/agents", match: "prefix" },
  { label: "Agent Sessions", href: "/ag-admin/sessions", match: "prefix" },
  { label: "HITL / CBAA", href: "/ag-admin/hitl", match: "prefix" },
  { label: "Revocations", href: "/ag-admin/revocations", match: "prefix" },
  { label: "Audit / Activity", href: "/ag-admin/audit", match: "prefix" },
  { label: "MCP Server", href: "/ag-admin/mcp", match: "prefix" },
  { label: "PolicyPacks", href: "/ag-admin/policy-packs", match: "prefix" },
];

/** Items that exist on the AG management surface but not yet in the UI. */
const PLACEHOLDER_LABELS: string[] = [];

export function AgAdminNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col flex-1">
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
        {PLACEHOLDER_LABELS.map((label) => (
          <NavItemDisabled key={label} label={label} />
        ))}
      </nav>

      {/* Sign-out — POST to /api/ag/logout to clear the ag_access_token cookie */}
      <div className="px-3 pb-4">
        <form action="/api/ag/logout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center rounded-lg px-3 py-2 text-sm text-sky-700 hover:bg-sky-900/40 hover:text-sky-300 transition-colors text-left"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
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
