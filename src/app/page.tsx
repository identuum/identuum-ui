import { redirect } from "next/navigation";
import { upgradeStateNeedsWizard } from "@/lib/runtime-composition";
import { getServerRuntimeState } from "@/lib/server-runtime-state";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const state = await getServerRuntimeState();

  if (!state) {
    redirect("/setup-required");
  }

  if (state.mode === "unconfigured") {
    redirect("/setup-required");
  }

  // OSS-to-CE upgrade wizard: if the IDP reports an upgrade-required
  // state, route operators to /upgrade BEFORE any other dispatch.
  // The CE binary in upgrade mode mounts only /healthz + /api/upgrade/*,
  // so it shows up as not usable here — but the upgradeState probe still
  // runs and surfaces the state. Older OSS backends without
  // /api/upgrade/status leave upgradeState as null and fall through.
  const upgradeState = state.components.idp.upgradeState;
  if (upgradeState && upgradeStateNeedsWizard(upgradeState.state)) {
    redirect("/upgrade");
  }

  if (state.mode === "misconfigured") {
    // Both backends are configured but neither is usable. Show the status
    // page so the operator can see what is wrong with each backend.
    redirect("/platform-status");
  }

  // Appliance first-run setup foundation: if the IDP is usable and
  // reports that setup is required, send the operator straight to the
  // wizard before any login/AG dispatch. Backends without the
  // /api/setup/status endpoint (older OSS / non-IDP-OSS) leave
  // setupState as null and fall through to the default behaviour.
  if (state.components.idp.usable && state.components.idp.setupState?.state === "setup_required") {
    redirect("/setup");
  }

  if (state.mode === "agent-governance-only" || state.mode === "degraded-idp-unavailable") {
    // AG is the only usable backend. Route operators to the AG shell.
    redirect("/ag-admin");
  }

  // IDP is usable. Use the standard login flow.
  redirect("/login");
}
