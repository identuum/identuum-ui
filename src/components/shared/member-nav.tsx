"use client";

/**
 * The org_user sidebar menu (UI-0912-A, owner Q5 a). ONE component, used by
 * both layouts that show the member sidebar — /dashboard and /account — so
 * the two cannot drift. Profile, Security, Sessions and Applications open their tab of
 * /account/settings; the item for the open tab is marked current.
 */
import { usePathname, useSearchParams } from "next/navigation";

type MemberNavItem = "overview" | "profile" | "security" | "sessions" | "applications";

const ITEMS: { key: MemberNavItem; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/dashboard" },
  { key: "profile", label: "Profile", href: "/account/settings?tab=profile" },
  { key: "security", label: "Security", href: "/account/settings?tab=password" },
  { key: "sessions", label: "Sessions", href: "/account/settings?tab=sessions" },
  { key: "applications", label: "Applications", href: "/account/settings?tab=applications" },
];

function currentItem(pathname: string, tab: string | null): MemberNavItem | null {
  if (pathname === "/dashboard") return "overview";
  if (pathname !== "/account/settings") return null;
  if (tab === "profile") return "profile";
  if (tab === "sessions") return "sessions";
  if (tab === "applications") return "applications";
  // The settings page opens on the password tab when none is named; passkeys
  // are a sign-in method, so they belong to Security too (U10).
  if (tab === null || tab === "password" || tab === "mfa" || tab === "passkeys") return "security";
  return null;
}

export function MemberNav() {
  const current = currentItem(usePathname(), useSearchParams().get("tab"));
  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {ITEMS.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={current === item.key ? "page" : undefined}
          className={
            current === item.key
              ? "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white bg-sky-800/50"
              : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
          }
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
