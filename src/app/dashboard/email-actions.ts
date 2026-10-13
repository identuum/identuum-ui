"use server";

/**
 * UI-0912-A4 (OSS v0.9.12 C2): the member asks for a verification email to
 * their own address. No address or user id comes from the browser; the IdP
 * takes the user from the session.
 *
 * - A lost session goes to the sign-in page.
 * - The site_admin cannot verify this way (OSS refuses it); the action never
 *   calls the IdP for that role.
 * - "already_verified" means the page's data is stale: it is re-read.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SendVerificationOutcome } from "@/lib/email-verification";
import { sendOwnVerificationEmail } from "@/lib/idp-account-client";
import { getServerSession } from "@/lib/server-session";

export interface SendVerificationState {
  outcome?: Exclude<SendVerificationOutcome, "unauthorized">;
}

export async function sendVerificationEmailAction(
  _prev: SendVerificationState,
  _formData: FormData
): Promise<SendVerificationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role === "site_admin") return { outcome: "not_for_account" };

  const { outcome } = await sendOwnVerificationEmail();
  if (outcome === "unauthorized") redirect("/login?reason=session_expired");
  if (outcome === "already_verified") {
    revalidatePath("/dashboard");
    revalidatePath("/account/settings");
  }
  return { outcome };
}
