/**
 * BackendNotConfiguredNotice — the shared "this backend is not enabled here"
 * state for site-admin pages whose whole purpose needs a specific backend
 * (the org-link console and its readiness page need BOTH IdP and AG).
 *
 * ABSENCE IS NOT FAILURE (THE-ABSENT-BACKEND): when a required backend is
 * not enabled in the runtime config, these pages state the not-configured
 * fact plainly instead of rendering their console with that backend framed
 * as unreachable. The absent backend can be AG or the IdP — the rule is
 * symmetric — and BOTH absent is an ERROR (a runtime config with no enabled
 * backend is invalid by construction: identuum-ui-setup refuses to write
 * one), presented in the error style, not as a calm empty state.
 *
 * The AG copy matches the /ag-admin route guard
 * (src/app/ag-admin/layout.tsx, `not_enabled` variant) so the platform says
 * the same thing everywhere; the IdP copy mirrors it.
 *
 * General surfaces (platform status, settings, overview) do NOT render this —
 * they omit the absent backend entirely. This notice exists only for pages a
 * user reaches by an explicit feature URL, where silence would read as a
 * broken page.
 */

export type MissingBackend = "ag" | "idp" | "both";

const COPY: Record<MissingBackend, { badge: string; heading: string; body: string }> = {
  ag: {
    badge: "AG",
    heading: "Agent Governance not configured",
    body: "identuum-ag is not enabled in the current runtime configuration. Add an AG backend to your runtime config to access governance features.",
  },
  idp: {
    badge: "IdP",
    heading: "Identity Provider not configured",
    body: "identuum-idp is not enabled in the current runtime configuration. Add an IdP backend to your runtime config to access identity features.",
  },
  both: {
    badge: "!",
    heading: "No backends are enabled",
    body: "Neither identuum-idp nor identuum-ag is enabled in the current runtime configuration. This is an invalid configuration — identuum-ui-setup never writes it. Re-run identuum-ui-setup or repair config/ui-runtime.json.",
  },
};

export function BackendNotConfiguredNotice({
  title,
  missing,
}: {
  title: string;
  missing: MissingBackend;
}) {
  const { badge, heading, body } = COPY[missing];
  const isError = missing === "both";
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-sky-950 tracking-tight">{title}</h1>
      </div>
      <div
        className={`rounded-[1.5rem] border p-8 text-center space-y-3 ${
          isError ? "border-red-200 bg-red-50" : "border-stone-200 bg-white"
        }`}
      >
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center mx-auto ${
            isError ? "bg-red-100" : "bg-stone-200"
          }`}
        >
          <span className={`text-sm font-bold ${isError ? "text-red-500" : "text-stone-400"}`}>
            {badge}
          </span>
        </div>
        <p className={`text-sm font-semibold ${isError ? "text-red-800" : "text-sky-950"}`}>
          {heading}
        </p>
        <p
          className={`text-xs leading-relaxed max-w-sm mx-auto ${
            isError ? "text-red-700" : "text-stone-500"
          }`}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
