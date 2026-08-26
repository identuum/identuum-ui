/**
 * PlatformLicenseWarnings
 *
 * Async Server Component. Fetches current runtime state via React cache and
 * renders a compact warning strip when one or more backend licenses need
 * operator attention. Renders nothing when all licenses are healthy.
 *
 * Security: renders only the safe message string from LicenseWarning — no raw
 * license payload, entitlements, features, customer data, or key material.
 * All field extraction is handled by runtime-composition.ts (explicit allowlist)
 * and deriveLicenseWarnings() (reads only ComponentLicenseInfo safe fields).
 */
import "server-only";

import { deriveLicenseWarnings, type LicenseWarning } from "@/lib/license-warnings";
import { getServerRuntimeState } from "@/lib/server-runtime-state";

export async function PlatformLicenseWarnings() {
  const state = await getServerRuntimeState();
  if (!state) return null;

  const warnings = deriveLicenseWarnings(state.components);
  if (warnings.length === 0) return null;

  return (
    <div>
      {warnings.map((w) => (
        <WarningStrip key={w.backendId} warning={w} />
      ))}
    </div>
  );
}

function WarningStrip({ warning }: { warning: LicenseWarning }) {
  const isCritical = warning.severity === "critical";

  const containerClass = isCritical
    ? "flex items-center gap-2.5 px-6 py-2 bg-red-50 border-b border-red-100"
    : "flex items-center gap-2.5 px-6 py-2 bg-amber-50 border-b border-amber-100";

  const dotClass = isCritical
    ? "h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
    : "h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0";

  const textClass = isCritical ? "text-xs text-red-700 font-medium" : "text-xs text-amber-700";

  return (
    <div className={containerClass} data-testid={`license-warning-${warning.backendId}`}>
      <div className={dotClass} aria-hidden="true" />
      <p className={textClass}>{warning.message}</p>
    </div>
  );
}
