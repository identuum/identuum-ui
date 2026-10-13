/**
 * UI-0912-A4: how the mailbox was proven, or "Not verified yet" with the
 * send button. A server that cannot send email says so and offers no button
 * (owner rule 2026-10-12 18:05). The site_admin is never offered it.
 *
 * UI-0913-A: shared by the member Overview and the account settings Profile
 * tab (owner Q7 a: administrators get the same row). The no-email sentinel
 * address of a manual invite is never offered the button (O20).
 */
import { isNoEmailSentinel } from "@/app/org-admin/users/[id]/user-detail-actions";
import { type MemberEmailStatus, NOT_CONFIGURED_TEXT } from "@/lib/email-verification";
import { SendVerificationEmail } from "./send-verification-email";

export function EmailStatus({
  status,
  address,
  mailReady,
  offerSend,
}: {
  status: MemberEmailStatus;
  address: string;
  mailReady: boolean;
  offerSend: boolean;
}) {
  const badge = (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
        status.proven ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"
      }`}
    >
      {status.label}
    </span>
  );
  if (status.proven || !offerSend || isNoEmailSentinel(address)) return badge;
  if (!mailReady) {
    return <span className="text-xs font-normal text-amber-700">{NOT_CONFIGURED_TEXT}</span>;
  }
  return (
    <div className="space-y-2">
      {badge}
      <div className="font-normal">
        <SendVerificationEmail address={address} />
      </div>
    </div>
  );
}
