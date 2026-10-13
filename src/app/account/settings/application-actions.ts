"use server";

/**
 * D3 (v0.9.13): "Remove access" on the Applications tab of /account/settings.
 * The user is the signed-in principal only; the browser sends the client_id
 * and nothing else (identuum-idp-oss refuses a user_id).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revokeOwnConsent } from "@/lib/idp-account-client";
import { getServerSession } from "@/lib/server-session";

export interface RemoveApplicationState {
  phase: "idle" | "removed" | "gone" | "error";
  error?: string;
}

const FAILED = "Access could not be removed. Try again.";

export async function removeApplicationAccessAction(
  _prev: RemoveApplicationState,
  formData: FormData
): Promise<RemoveApplicationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const clientId = ((formData.get("client_id") as string | null) ?? "").trim();
  if (!clientId) return { phase: "error", error: FAILED };

  const { outcome } = await revokeOwnConsent(clientId);
  if (outcome === "unavailable") return { phase: "error", error: "Not available on this server." };
  if (outcome === "failed") return { phase: "error", error: FAILED };
  revalidatePath("/account/settings");
  revalidatePath("/dashboard");
  return { phase: outcome };
}
