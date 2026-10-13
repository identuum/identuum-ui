/**
 * D3 (v0.9.13): the Overview's Applications card text, from
 * GET /api/v1/me/consents. identuum-idp-ce does not serve it.
 */
import type { ListConsentsResult } from "@/lib/idp-account-client";

export function ApplicationFacts({ result }: { result: ListConsentsResult }) {
  if (!result.ok) {
    return (
      <p>
        {result.unavailable
          ? "Not available on this server."
          : "We could not load this right now. Open the page to see it."}
      </p>
    );
  }
  const n = result.consents.length;
  if (n === 0) return <p>You have not allowed any applications yet.</p>;
  return (
    <p>{n === 1 ? "You have allowed 1 application." : `You have allowed ${n} applications.`}</p>
  );
}
