/**
 * OSS-FIN-3 item 6: the audit list shows the actor (its type and email, a
 * client's client_id, or a short id) and the organization a row concerns; the
 * org_admin audit page shows its organization's rows — the site admin's
 * changes to it included — named as the organization.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AuditEventItem } from "@/lib/idp-admin-client";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/org-admin/audit" }));
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({ components: { idp: { capabilities: {} } } }),
}));

const ORG = "01990000-0000-7000-8000-00000000000a";
const row = (over: Partial<AuditEventItem>): AuditEventItem => ({
  id: "01990000-0000-7000-8000-0000000000e1",
  created_at: "2026-09-29T10:00:00Z",
  event_type: "organization.updated",
  outcome: "success",
  actor_id: "01990000-0000-7000-8000-0000000000a1",
  actor_email: "site_admin@system.local",
  actor_type: "user",
  actor_role: "site_admin",
  actor_organization_id: "00000000-0000-0000-0000-000000000001",
  organization_id: ORG,
  subject_id: null,
  subject_email: null,
  subject_type: null,
  ip_address: null,
  user_agent: null,
  request_id: null,
  correlation_id: null,
  priority: "normal",
  metadata: null,
  ...over,
});

vi.mock("../lib/idp-admin-client", () => ({
  listAuditEvents: async () => ({
    ok: true,
    events: [row({})],
    total_count: 1,
    page: 1,
    page_size: 50,
  }),
  listAuditEventTypes: async () => null,
  getOwnOrganization: async () => ({ id: ORG, name: "Acme Fin3" }),
}));

describe("the actor and organization cells", () => {
  it("names the actor's type, role and email", async () => {
    const { AuditActorCell } = await import("../components/shared/audit-actor-cell");
    const html = renderToStaticMarkup(<AuditActorCell event={row({})} />);
    expect(html).toContain("User · site_admin");
    expect(html).toContain("site_admin@system.local");
    expect(html).toContain('data-actor-type="user"');
  });
  it("shows a client's client_id, a service account's short id, and anonymous plainly", async () => {
    const { AuditActorCell } = await import("../components/shared/audit-actor-cell");
    const client = renderToStaticMarkup(
      <AuditActorCell
        event={row({
          actor_type: "client",
          actor_email: null,
          actor_role: null,
          actor_id: null,
          metadata: { actor_client_id: "cid-fin3" },
        })}
      />
    );
    expect(client).toContain("Client");
    expect(client).toContain("cid-fin3");
    const sa = renderToStaticMarkup(
      <AuditActorCell event={row({ actor_type: "service_account", actor_email: null })} />
    );
    expect(sa).toContain("Service account");
    expect(sa).toContain("01990000…");
    const anon = renderToStaticMarkup(
      <AuditActorCell
        event={row({ actor_type: "anonymous", actor_email: null, actor_id: null, actor_role: null })}
      />
    );
    expect(anon).toContain("Anonymous");
  });
  it("names the organization when known, else a short id, else Platform", async () => {
    const { AuditOrganizationCell } = await import("../components/shared/audit-actor-cell");
    expect(
      renderToStaticMarkup(<AuditOrganizationCell event={row({})} names={{ [ORG]: "Acme Fin3" }} />)
    ).toContain("Acme Fin3");
    expect(renderToStaticMarkup(<AuditOrganizationCell event={row({})} />)).toContain("01990000…");
    expect(
      renderToStaticMarkup(<AuditOrganizationCell event={row({ organization_id: null })} />)
    ).toContain("Platform");
  });
});

describe("the org-admin audit page", () => {
  it("shows the site admin's change to its organization with the actor and the organization's name", async () => {
    const { default: Page } = await import("../app/org-admin/audit/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(">Organization<");
    expect(html).toContain("organization.updated");
    expect(html).toContain("User · site_admin");
    expect(html).toContain("Acme Fin3");
  });
});
