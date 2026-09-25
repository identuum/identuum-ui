/**
 * Plan D-4: the pages outside the administration areas — the public
 * ceremonies (activate, claim, forgot/reset password, verify email), the
 * appliance states (setup, setup-required, upgrade, platform-status), the
 * sign-in page, the org_user dashboard and the personal account settings —
 * over the SAME layout and page modules as Next (src/app). The machinery that
 * composes a route is the areas' (area-routes.tsx).
 */
import type { ReactNode } from "react";
import AccountLayout, { metadata as accountLayoutMeta } from "@/app/account/layout";
import AccountSettingsPage, { metadata as accountSettingsMeta } from "@/app/account/settings/page";
import ActivatePage, { metadata as activateMeta } from "@/app/activate/page";
import ClaimPage, { metadata as claimMeta } from "@/app/claim/page";
import DashboardLayout, { metadata as dashboardLayoutMeta } from "@/app/dashboard/layout";
import DashboardPage, { metadata as dashboardMeta } from "@/app/dashboard/page";
import DashboardSecurityRedirect from "@/app/dashboard/security/page";
import ForgotPasswordPage, { metadata as forgotMeta } from "@/app/forgot-password/page";
import { metadata as loginMeta } from "@/app/login/page";
import LogoutPage, { metadata as logoutMeta } from "@/app/logout/page";
import PlatformStatusPage, { metadata as platformStatusMeta } from "@/app/platform-status/page";
import ResetPasswordPage, { metadata as resetMeta } from "@/app/reset-password/page";
import SetupPage, { metadata as setupMeta } from "@/app/setup/page";
import SetupRequiredPage, { metadata as setupRequiredMeta } from "@/app/setup-required/page";
import UpgradePage, { metadata as upgradeMeta } from "@/app/upgrade/page";
import VerifyEmailPage, { metadata as verifyMeta } from "@/app/verify-email/page";
import { type Area, buildAreaRoute, route } from "./area-routes";
import { ExportLoginPage } from "./login-route";

/** The root layout's frame is the export's index.html; public pages add none. */
function PassThrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const PUBLIC_AREA: Area = {
  layout: PassThrough,
  layoutMeta: undefined,
  routes: [
    route(/^\/activate$/, [], ActivatePage, activateMeta),
    route(/^\/claim$/, [], ClaimPage, claimMeta),
    route(/^\/forgot-password$/, [], ForgotPasswordPage, forgotMeta),
    route(/^\/reset-password$/, [], ResetPasswordPage, resetMeta),
    route(/^\/verify-email$/, [], VerifyEmailPage, verifyMeta),
    route(/^\/setup-required$/, [], SetupRequiredPage, setupRequiredMeta),
    route(/^\/upgrade$/, [], UpgradePage, upgradeMeta),
    route(/^\/setup$/, [], SetupPage, setupMeta),
    route(/^\/platform-status$/, [], PlatformStatusPage, platformStatusMeta),
    route(/^\/login$/, [], ExportLoginPage, loginMeta),
    route(/^\/logout$/, [], LogoutPage, logoutMeta),
  ],
};

export const DASHBOARD_AREA: Area = {
  layout: DashboardLayout,
  layoutMeta: dashboardLayoutMeta,
  routes: [
    route(/^\/dashboard$/, [], DashboardPage, dashboardMeta),
    route(/^\/dashboard\/security$/, [], DashboardSecurityRedirect, undefined),
  ],
};

export const ACCOUNT_AREA: Area = {
  layout: AccountLayout,
  layoutMeta: accountLayoutMeta,
  routes: [route(/^\/account\/settings$/, [], AccountSettingsPage, accountSettingsMeta)],
};

export const PUBLIC_PATHS = PUBLIC_AREA.routes.map((r) => r.pattern);

export function buildPublicRoute(pathname: string, query: URLSearchParams) {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return buildAreaRoute(DASHBOARD_AREA, pathname, query);
  }
  if (pathname.startsWith("/account/")) return buildAreaRoute(ACCOUNT_AREA, pathname, query);
  return buildAreaRoute(PUBLIC_AREA, pathname, query);
}
