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

describe("the capability projection carries public_clients", () => {
  it("keeps the IdP's public_clients answer (the export reads only projected keys)", async () => {
    const { extractCapabilities } = await import("../lib/runtime-composition");
    expect(extractCapabilities({ public_clients: false }).public_clients).toBe(false);
    expect(extractCapabilities({ public_clients: true }).public_clients).toBe(true);
    expect(extractCapabilities({}).public_clients).toBeUndefined();
  });
});

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
