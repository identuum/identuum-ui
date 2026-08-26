import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUpgradeStatus } from "@/lib/idp-upgrade-client";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { UpgradeWizard } from "./upgrade-wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Upgrade — Identuum" };

/**
 * `/upgrade` is the customer-facing OSS-to-CE upgrade wizard for
 * self-hosted Identuum IDP. It is shown only while the CE binary
 * reports a state that needs operator action from
 * `GET /api/upgrade/status`. Once the wizard reaches
 * `upgrade_complete` the page advises the operator to restart the
 * CE service and continue with first-run setup.
 *
 * The wizard hides internal schema details from the customer per
 * D-IDP-INSTALL-14: only the backend's friendly Label + next_action
 * strings reach the primary copy. The operator-facing `Detail`
 * strings are surfaced under an optional "Show details" disclosure
 * inside the impact-preview card.
 */
export default async function UpgradePage() {
  // If the UI runtime config is missing, the older /setup-required
  // page owns that boundary. The /upgrade wizard is not the right
  // surface for that state.
  const cfg = loadRuntimeConfig();
  if (!cfg) {
    redirect("/setup-required");
  }

  const status = await getUpgradeStatus();

  // If the backend reports CE schema is already current AND there is
  // no recent upgrade to surface, defense-in-depth send the operator
  // back to /login. The wizard client surface re-fetches status on
  // mount so a stale tab landing here does not strand the operator.
  if (status.kind === "ok" && status.status.state === "ce_migrations_current") {
    redirect("/login");
  }

  const initial =
    status.kind === "ok"
      ? {
          state: status.status.state,
          distribution: status.status.distribution,
          product: status.status.product,
          upgradeAvailable: status.status.upgradeAvailable,
          backupRequired: status.status.backupRequired,
          ossDatabaseDetected: status.status.ossDatabaseDetected,
          ceMigrationsCurrent: status.status.ceMigrationsCurrent,
          nextAction: status.status.nextAction,
          pendingCount: status.status.pendingCount,
          appliedVersion: status.status.appliedVersion,
          targetVersion: status.status.targetVersion,
        }
      : null;

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Subtle ambient warmth, consistent with the setup wizard. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-2xl">
        {/* Wordmark + logo mark */}
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 py-8">
            <h1 className="text-xl font-bold text-sky-950 tracking-tight">
              Upgrade to identuum CE
            </h1>
            <p className="mt-1 text-sm text-stone-500 leading-relaxed">
              Welcome. This wizard upgrades your self-hosted Identuum IDP to the commercial edition.
              It runs once. Your existing users, organizations, OAuth clients, and sessions are
              preserved.
            </p>

            <UpgradeWizard initialStatus={initial} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          identuum — single-node self-hosted install
        </p>
      </div>
    </div>
  );
}
