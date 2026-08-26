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

const regenerateSchema = z.object({
  confirm: z.string(),
});

export async function regenerateRecoveryCodesAction(
  _prev: RegenerateRecoveryCodesState,
  formData: FormData
): Promise<RegenerateRecoveryCodesState> {
  await requireHumanSession();

  const parsed = regenerateSchema.safeParse({
    confirm: ((formData.get("confirm") as string | null) ?? "").trim(),
  });
  if (!parsed.success || parsed.data.confirm !== "REGENERATE") {
    return { phase: "error", error: "Type REGENERATE to confirm." };
  }

  const result = await regenerateOwnMfaRecoveryCodes();
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
    if (result.unauthorized) {
      return { phase: "error", error: "Your session has expired. Sign in again." };
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

const disableSchema = z.object({
  confirm: z.string(),
  code: z.string(),
  password: z.string(),
});

export async function disableMfaAction(
  _prev: DisableMfaState,
  formData: FormData
): Promise<DisableMfaState> {
  await requireHumanSession();

  const parsed = disableSchema.safeParse({
    confirm: ((formData.get("confirm") as string | null) ?? "").trim(),
    code: ((formData.get("code") as string | null) ?? "").trim(),
    password: (formData.get("password") as string | null) ?? "",
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
  if (!parsed.data.code && !parsed.data.password) {
    return {
      phase: "error",
      error: "Enter an authenticator/recovery code or your current password.",
      fieldErrors: { proof: "Required." },
    };
  }

  const result = await disableOwnMfa({
    code: parsed.data.code,
    password: parsed.data.password,
  });

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
    if (result.invalidProof) {
      return {
        phase: "error",
        error:
          "Could not verify the proof. Try a current authenticator code, recovery code, or password.",
        fieldErrors: { proof: "Invalid proof." },
      };
    }
    return { phase: "error", error: "Could not disable MFA. Try again." };
  }

  revalidatePath("/account/settings");
  return { phase: "success" };
}
