/**
 * server-runtime-state for the static export: the same component discovery
 * (src/lib/runtime-composition.ts, shared) against this origin — the binary
 * serving the export is the IdP — and no AG. Shared per route load.
 */
import { discoverRuntime } from "@/lib/runtime-composition";
import type { RuntimeState } from "@/lib/types";
import { routeGeneration } from "../router";

let memo: { generation: number; state: Promise<RuntimeState | null> } | null = null;

export function getServerRuntimeState(): Promise<RuntimeState | null> {
  const generation = routeGeneration();
  if (memo?.generation !== generation) {
    memo = {
      generation,
      state: discoverRuntime(window.location.origin, null).then((state) => {
        state.agCEOrgLinkAvailability = null;
        return state;
      }),
    };
  }
  return memo.state;
}
