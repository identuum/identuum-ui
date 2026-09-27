/**
 * CE-UI-3b: identuum-idp-ce registers no public clients
 * (capabilities.public_clients === false), so the create-application form
 * offers no "Public client" option there. An IdP that does not report the
 * key (identuum-idp-oss) keeps it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(),
}));

describe("the create-application form and public_clients", () => {
  it("offers no public-client option where the IdP registers none", async () => {
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    const html = renderToStaticMarkup(<CreateApplicationForm publicClients={false} />);
    expect(html).not.toContain('name="is_public"');
    expect(html).not.toContain("Public client");
  });
  it("keeps it where the IdP does not say otherwise", async () => {
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    const html = renderToStaticMarkup(<CreateApplicationForm publicClients />);
    expect(html).toContain('name="is_public"');
  });
});
