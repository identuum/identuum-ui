import { upgradeStateNeedsWizard } from "@/lib/runtime-composition";
import { loadRuntimeConfig, toPublicConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginPageClient } from "./client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Identuum" };

export default async function LoginPage() {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    redirect("/setup-required");
  }

  // Defense in depth: if the IDP reports first-run setup is required,
  // direct visitors to /login land in the wizard instead of seeing a
  // sign-in form that can't yet authenticate anyone. The root page
  // performs the same check; this guards the case where the operator
  // bookmarks or types /login directly.
  const runtimeState = await getServerRuntimeState();
  const upgradeState = runtimeState?.components.idp.upgradeState;
  if (upgradeState && upgradeStateNeedsWizard(upgradeState.state)) {
    redirect("/upgrade");
  }
  if (
    runtimeState?.components.idp.usable &&
    runtimeState.components.idp.setupState?.state === "setup_required"
  ) {
    redirect("/setup");
  }

  const publicCfg = toPublicConfig(cfg);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient background blobs — restrained, mix-blend-multiply so they
          blend softly into the stone-50 page colour without overpowering. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Wordmark + logo mark */}
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>

        {/* Login card */}
        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6">
            <h2 className="text-lg font-bold text-sky-950 mb-1 tracking-tight">Sign in</h2>
            <p className="text-sm text-stone-500 mb-6 leading-relaxed">
              Enter your credentials to continue
            </p>
            <LoginPageClient config={publicCfg} />
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-stone-400">
          identuum — identitas tua, in potestate tua
        </p>
      </div>
    </div>
  );
}
