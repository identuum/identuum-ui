import { AlertCircle, Terminal } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Setup Required — Identuum" };

export default function SetupRequiredPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Logo / wordmark */}
        <div className="text-center mb-10">
          <span className="text-2xl font-bold tracking-tight text-white">identuum</span>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <AlertCircle className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">Setup required</h1>
              <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                identuum-ui has not been configured yet. Run the one-shot setup helper to write the
                runtime configuration before using the UI.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded border border-slate-700 bg-slate-950 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Local Docker Compose
              </span>
            </div>
            <code className="block text-sm text-green-400 leading-relaxed whitespace-pre-wrap break-all">
              {`docker compose -f deployment/docker-compose.local.yml \\
  --profile setup run --rm -T \\
  identuum-ui-setup`}
            </code>
          </div>

          <div className="mt-4 text-sm text-slate-500 leading-relaxed">
            <p>
              The setup helper writes the runtime configuration into a shared volume. The UI will
              become available automatically once configuration is written.
            </p>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-5">
            <p className="text-xs text-slate-600">
              If you have already run setup and are still seeing this page, verify that the UI
              container has the correct volume mount for{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-400">/app/config</code>.
            </p>
          </div>
        </div>

        {/* Health endpoint note */}
        <p className="mt-6 text-center text-xs text-slate-600">
          The UI health endpoint{" "}
          <code className="rounded bg-slate-900 px-1 py-0.5 text-slate-500">GET /api/health</code>{" "}
          is always available regardless of setup state.
        </p>
      </div>
    </div>
  );
}
