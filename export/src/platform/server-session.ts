/**
 * server-session for the static export: the same tri-state verdict, retry
 * budget and redirect meanings as src/lib/server-session.ts, with the
 * validation request sent through the Go boundary (/bff) instead of the
 * server's cookie hop. Shared per route load the way Next shares it per
 * request (React cache()).
 */
import { type SessionState, validateSessionResponse } from "@/lib/session-validation";
import type { ValidateResponse } from "@/lib/types";
import { bff } from "../bff";
import { routeGeneration } from "../router";
import { redirect } from "./next-navigation";

export type { SessionState } from "@/lib/session-validation";
export {
  parseRetryAfterSeconds,
  planNextWaitMs,
  SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS,
  SESSION_VALIDATE_MAX_WAIT_MS,
  SESSION_VALIDATE_TOTAL_CAP_MS,
} from "@/lib/session-validation";

let memo: { generation: number; state: Promise<SessionState> } | null = null;

export function getServerSessionState(): Promise<SessionState> {
  const generation = routeGeneration();
  if (memo?.generation !== generation) {
    memo = {
      generation,
      state: validateSessionResponse((signal) => bff("/api/v1/validate", { signal })),
    };
  }
  return memo.state;
}

export function unavailablePath(state: Extract<SessionState, { kind: "unavailable" }>): string {
  const params = new URLSearchParams();
  if (state.correlationId) params.set("cid", state.correlationId);
  if (state.status !== null) params.set("status", String(state.status));
  if (state.retryAfterSeconds !== null) params.set("retry", String(state.retryAfterSeconds));
  const qs = params.toString();
  return qs ? `/unavailable?${qs}` : "/unavailable";
}

export async function getServerSession(): Promise<ValidateResponse | null> {
  const state = await getServerSessionState();
  if (state.kind === "authenticated") return state.session;
  if (state.kind === "unavailable") redirect(unavailablePath(state));
  return null;
}
