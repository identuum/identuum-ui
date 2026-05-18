import { loadRuntimeConfig, runtimeMode } from "@/lib/runtime-config";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RootPage() {
  const cfg = loadRuntimeConfig();
  if (!cfg) {
    redirect("/setup-required");
  }
  // Governor-only: no IdP is configured, human login is unavailable.
  // Send operators directly to the AG governance section.
  if (runtimeMode(cfg) === "governor-only") {
    redirect("/ag-admin");
  }
  // IdP-enabled modes (auth-service, hybrid) use the standard login flow.
  redirect("/login");
}
