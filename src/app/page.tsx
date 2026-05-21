import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const state = await getServerRuntimeState();

  if (!state) {
    redirect("/setup-required");
  }

  switch (state.mode) {
    case "unconfigured":
      redirect("/setup-required");

    case "misconfigured":
      // Both backends are configured but neither is usable. Show the status
      // page so the operator can see what is wrong with each backend.
      redirect("/platform-status");

    case "agent-governance-only":
    case "degraded-idp-unavailable":
      // AG is the only usable backend. Route operators to the AG shell.
      redirect("/ag-admin");

    case "identity-only":
    case "degraded-ag-unavailable":
    case "full-platform":
    default:
      // IDP is usable. Use the standard login flow.
      redirect("/login");
  }
}
