"use server";

/** D-021: the site administrator's instance self-registration switch. */

import { redirect } from "next/navigation";
import { setInstanceRegistration } from "@/lib/idp-registration-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

export interface InstanceRegistrationState {
  enabled: boolean;
  error?: string;
}

export async function setInstanceRegistrationAction(
  prev: InstanceRegistrationState,
  formData: FormData
): Promise<InstanceRegistrationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") redirect(roleToPath(role));
  const enabled = formData.get("enabled") === "true";
  const r = await setInstanceRegistration(enabled);
  if (!r.ok) return { enabled: prev.enabled, error: r.message };
  return { enabled: r.value.enabled };
}
