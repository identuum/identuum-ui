import type { Metadata } from "next";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
/**
 * Site-admin System landing — index of the three read-only system
 * observability sub-pages: sessions, audit chain verification,
 * runtime info.
 *
 * Slice identuum-20260530-site-admin-observability-pages.
 *
 * EDITION-SURFACE-1: cards for commercial-only surfaces are HONESTLY LABELLED
 * from the measured capability source (the same ComponentCapabilities the
 * site-admin nav gates on, read from getServerRuntimeState). A card whose
 * capability is discovered false — or which is commercial-only with no
 * discovered capability key at all (admin sessions; the OSS component payload
 * carries no admin_sessions/system_sessions flag) — is tagged so an OSS
 * operator is not sent to a page that reads as an outage.
 */
import type { ComponentCapabilities } from "@/lib/types";

export const metadata: Metadata = {
  title: "System — Identuum Site Admin",
};

interface SystemCard {
  title: string;
  description: string;
  href: string;
  // capability, when set, gates the card on the discovered capability source:
  // the card is labelled commercial when the capability is explicitly false.
  capability?: keyof ComponentCapabilities;
  // commercialWithoutCapability marks a commercial-only surface for which the
  // capability payload carries NO key (measured: admin sessions). It is
  // labelled commercial unconditionally — the honest reading of an absent key.
  commercialWithoutCapability?: boolean;
}

const SYSTEM_CARDS: SystemCard[] = [
  {
    title: "Admin sessions",
    description:
      "Read-only list of active admin sessions. No emergency-revoke control is rendered.",
    href: "/site-admin/system/sessions",
    commercialWithoutCapability: true,
  },
  {
    title: "Audit chain verify",
    description: "On-demand integrity check of the per-organization audit hash chain. Read-only.",
    href: "/site-admin/system/audit-chain",
    capability: "audit_chain",
  },
  {
    title: "Runtime info",
    description: "Version, dependency liveness, and audit-queue depth.",
    href: "/site-admin/system/info",
  },
];

function isCommercialOnly(card: SystemCard, caps: ComponentCapabilities | null): boolean {
  if (card.commercialWithoutCapability) return true;
  if (card.capability) return caps?.[card.capability] === false;
  return false;
}

export default async function SiteAdminSystemPage() {
  const runtimeState = await getServerRuntimeState();
  const caps = runtimeState?.components.idp.capabilities ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">System</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only system observability. Mutating system actions (emergency revoke, backup restore,
          compliance attest) are not available here.
        </p>
      </div>
      <ul className="space-y-3">
        {SYSTEM_CARDS.map((c) => {
          const commercial = isCommercialOnly(c, caps);
          return (
            <li key={c.href}>
              <a
                href={c.href}
                aria-label={`Open ${c.title}`}
                className="block bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-sky-950">{c.title}</p>
                      {commercial && (
                        <span
                          data-testid={`system-card-commercial-${c.href.split("/").pop()}`}
                          className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                        >
                          Enterprise/CE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                      {c.description}
                      {commercial && (
                        <>
                          {" "}
                          Not included in your edition — opening it shows the edition boundary, not
                          an outage.
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-sky-700 shrink-0">Open →</span>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
