"use server";

import { updateAgPolicyPackSettings } from "@/lib/ag-policy-pack-client";
import type { AgPolicyPackSettings } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { policyPackSaveErrorMessage } from "./policy-pack-settings-helpers";

const schema = z.object({
  policy_packs_enabled: z.enum(["true", "false"]),
});

export interface UpdatePolicyPackSettingsActionState {
  ok?: true;
  settings?: AgPolicyPackSettings;
  error?: string;
}

export async function updatePolicyPackSettingsAction(
  _prev: UpdatePolicyPackSettingsActionState,
  formData: FormData
): Promise<UpdatePolicyPackSettingsActionState> {
  const raw = {
    policy_packs_enabled: ((formData.get("policy_packs_enabled") as string | null) ?? "").trim(),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid request. Refresh the page and try again." };
  }

  const enabled = parsed.data.policy_packs_enabled === "true";
  const result = await updateAgPolicyPackSettings(enabled);

  if (!result.ok) {
    if (result.authError) {
      return { error: "Session expired. Sign out and sign in again." };
    }
    return { error: policyPackSaveErrorMessage({ status: result.status }) };
  }

  revalidatePath("/ag-admin/policy-packs");
  return { ok: true, settings: result.settings };
}
