"use server";

/**
 * Server actions for authenticated self-service MFA management.
 *
 * The IDP derives the target user from the session principal. The browser
 * never sends a user identifier, MFA secret, or recovery-code list back to these
 * actions. Regenerated recovery codes are returned once in action state so
 * the client component can render them transiently.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { disableOwnMfa, regenerateOwnMfaRecoveryCodes } from "@/lib/idp-account-client";
import { getServerSession } from "@/lib/server-session";

const HUMAN_ROLES = new Set(["site_admin", "org_admin", "org_user"]);

async function requireHumanSession() {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (!HUMAN_ROLES.has(role as string)) redirect("/login?reason=session_expired");
}

export type RegenerateRecoveryCodesState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; recoveryCodes: string[]; count: number };

// THE-SELF-REPLENISHING-CODES (2026-09-10): identuum-idp-ce's regenerate
// verifies ONLY a current authenticator (TOTP) code — a recovery code is
// refused, so that a stolen session cannot mint ten fresh disable proofs
// (the disable accepts recovery codes). The IdP's refusal is deliberately
// cause-neutral (one 401 invalid_proof for absent, empty, wrong, recovery
// and locked alike), so this action and its form are where the user
// learns the rule: the code is required before any request, and the 401
// message names the authenticator code and the recovery-code exclusion.
const regenerateSchema = z.object({
  confirm: z.string(),
  code: z.string(),
});

export async function regenerateRecoveryCodesAction(
  _prev: RegenerateRecoveryCodesState,
  formData: FormData
): Promise<RegenerateRecoveryCodesState> {
  await requireHumanSession();

  const parsed = regenerateSchema.safeParse({
    confirm: ((formData.get("confirm") as string | null) ?? "").trim(),
    code: ((formData.get("code") as string | null) ?? "").trim(),
  });
  if (!parsed.success || parsed.data.confirm !== "REGENERATE") {
    return { phase: "error", error: "Type REGENERATE to confirm." };
  }
  if (!parsed.data.code) {
    return { phase: "error", error: "Enter your authenticator code." };
  }

  const result = await regenerateOwnMfaRecoveryCodes({ code: parsed.data.code });
  if (!result.ok) {
    if (result.unavailable) {
      return {
        phase: "error",
        error: "Recovery-code regeneration is not available from this IDP runtime.",
      };
    }
    if (result.notEnrolled) {
      return { phase: "error", error: "MFA is not enrolled on this account." };
    }
    // THE-SIX-SMALL-ONES, UI 1 (2026-09-16): a session that expired between
    // requireHumanSession and the IdP's answer is a 401 too — the client now
    // tells it from a refused proof by what the IdP said, and the message
    // that is true is "signed out", not "wrong code".
    if (result.unauthorized) {
      return { phase: "error", error: "Your session has expired. Sign in again." };
    }
    if (result.invalidProof) {
      return {
        phase: "error",
        error:
          "Could not verify the code. Enter a current authenticator code; recovery codes cannot regenerate recovery codes.",
      };
    }
    return { phase: "error", error: "Could not regenerate recovery codes. Try again." };
  }

  revalidatePath("/account/settings");
  return { phase: "success", recoveryCodes: result.recoveryCodes, count: result.count };
}

export type DisableMfaState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { confirm?: string; proof?: string } }
  | { phase: "success" };

// THE-STALE-PROOF (2026-09-10): the IdP verifies the disable ONLY through
// the second factor — identuum-idp-ce's HandleMeMFADisable runs
// mfaService.ValidateCode(code) and discards the password field (f89ca88).
// A password-only submission is a guaranteed 401 invalid_proof that also
// counts against the user's step-up lockout, so this action requires a
// code and reads no password. The wire shape is unchanged: disableOwnMfa
// still sends {code, password: ""}, both keys known to the IdP's decoder.
const disableSchema = z.object({
  confirm: z.string(),
  code: z.string(),
});

export async function disableMfaAction(
  _prev: DisableMfaState,
  formData: FormData
): Promise<DisableMfaState> {
  await requireHumanSession();

  const parsed = disableSchema.safeParse({
    confirm: ((formData.get("confirm") as string | null) ?? "").trim(),
    code: ((formData.get("code") as string | null) ?? "").trim(),
  });
  if (!parsed.success) {
    return { phase: "error", error: "Invalid request." };
  }
  if (parsed.data.confirm !== "DISABLE") {
    return {
      phase: "error",
      error: "Type DISABLE to confirm.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }
  if (!parsed.data.code) {
    return {
      phase: "error",
      error: "Enter an authenticator or recovery code.",
      fieldErrors: { proof: "Required." },
    };
  }

  const result = await disableOwnMfa({ code: parsed.data.code });

  if (!result.ok) {
    if (result.unavailable) {
      return { phase: "error", error: "MFA disable is not available from this IDP runtime." };
    }
    if (result.forbidden) {
      return {
        phase: "error",
        error:
          "MFA is required for this account or organization. Contact a site administrator for reset.",
      };
    }
    if (result.notEnrolled) {
      return { phase: "error", error: "MFA is not enrolled on this account." };
    }
    // THE-SIX-SMALL-ONES, UI 1: a signed-out session is not an invalid proof.
    if (result.unauthorized) {
      return { phase: "error", error: "Your session has expired. Sign in again." };
    }
    if (result.invalidProof) {
      return {
        phase: "error",
        error: "Could not verify the code. Try a current authenticator code or recovery code.",
        fieldErrors: { proof: "Invalid proof." },
      };
    }
    return { phase: "error", error: "Could not disable MFA. Try again." };
  }

  revalidatePath("/account/settings");
  return { phase: "success" };
}
