/**
 * THE-ORGANIZATION-SWEEP (2026-08-28) — batch 1 of the census complement.
 *
 * Covers ALL 22 organizations-family rows that behavioral-census.md listed
 * as NEITHER (8 DESTRUCTIVE, 10 SAFE-MUTATING, 4 SAFE-READ), each with at
 * least one asserted NON-2xx branch — the 122-of-133 gap this suite exists
 * for. Every status here is MEASURED live (probe runs of 2026-08-28), not
 * intended; where live behavior surprised, it is pinned and the surprise is
 * recorded in the wiki (sweep section of platform/disposable-harness.md).
 *
 * Session sharing: ONE site_admin login (via the e2e-full session helper —
 * TOTP enrolment happens once per fresh DB, in whichever spec file runs
 * first) and ONE activated org_admin, reused across every request in this
 * file. Serial by --workers=1.
 *
 * Measured behaviors deliberately pinned:
 *  - domain verify on a .test domain → 503 "dns lookup failed": the happy
 *    200 needs real DNS the disposable environment cannot provide.
 *  - adding a role scope with an EMPTY body → 403, not 400 (the zero UUID
 *    binds, then resource ownership fails first).
 *  - restore of a live org → 404 (nothing deleted to restore).
 *  - org_admin PUT of own-org protocol settings → 200 (matches the docgen
 *    auth annotation site_admin|org_admin).
 *  - export-candidates is tenant-scoped for org_admin (own org only).
 */
import { expect, test } from "@playwright/test";
import {
  api,
  assertActivationEnvelope,
  firstLoginBearerAsync,
} from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("organizations sweep (22 census rows, every one with a non-2xx)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  let orgAdmin = { bearer: "", totpSecret: "" };
  let runId = "";
  let org1 = "";

  test("setup: shared session + activated tenant org", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length, "harness must export the bootstrap password").toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `sweep-${Date.now().toString(36)}`;

    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `sweep1 ${runId}`,
        slug: `${runId}-1`,
        domain: `${runId}-1.test`,
        admin_email: `admin@${runId}-1.test`,
      },
      site.bearer
    );
    expect(created.status, "create org+pending admin → 201").toBe(201);
    org1 = (created.json.organization as { id?: string })?.id ?? "";
    expect(org1.length).toBeGreaterThan(0);

    // ROW resend-activation (D): happy on a pending org — re-issues the token.
    const resend = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/resend-activation`,
      {},
      site.bearer
    );
    expect(resend.status, "resend-activation on pending org → 200").toBe(200);
    const token = resend.json.activation_token as string;
    expect(token.length).toBeGreaterThan(0);

    // THE-UNUSABLE-TOKEN: the token must arrive with the link that CONSUMES
    // it, or with an honest reason naming the setting — never bare, never a
    // guessed URL. EXACTLY ONE of the two, on BOTH issuing endpoints.
    assertActivationEnvelope(resend.json, token, "resend-activation");
    assertActivationEnvelope(created.json, undefined, "create-organization");

    const adminPw = `Adm!${runId}9wqX`;
    // THE-UNUSABLE-TOKEN: consume the credential taken FROM THE LINK, not the
    // bare token field. This is the proof that matters — the link the
    // operator is told to send is one a real activation actually succeeds
    // with. (The harness configures IDENTUUM_IDP_UI_PUBLIC_BASE_URL, so the
    // link branch is the one in force here; the refusal branch is pinned by
    // the Go rule ACTIVATION-LINK-USABLE-1 and asserted above.)
    const linkToken = new URL(resend.json.activation_url as string).searchParams.get("token") ?? "";
    expect(linkToken, "the activation link carries the same credential").toBe(token);
    const activate = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: linkToken,
      password: adminPw,
    });
    expect(activate.status, "the token FROM THE LINK activates → 200").toBe(200);
    orgAdmin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}-1.test`, adminPw);
  });

  test("field validation: malformed organizations are refused at the API, not persisted", async () => {
    // THE-UNVALIDATED-DOMAIN (2026-08-31): creating an organization with the
    // domain "lexus" — no dot, no TLD — SUCCEEDED and persisted, because the
    // entire server-side check was `Domain == ""`. The owner widened the
    // ruling to every field. These are the API-level teeth for
    // ORG-DOMAIN-FORMAT-1: each request differs from a valid one in exactly
    // ONE field, so a 201 names precisely which guard disappeared.
    const bad: Array<{ why: string; body: Record<string, unknown> }> = [
      { why: "domain with no dot or TLD — THE REPORTED DEFECT", body: { domain: "lexus" } },
      { why: "single-label domain, however familiar", body: { domain: "localhost" } },
      { why: "domain with a numeric TLD", body: { domain: "example.123" } },
      { why: "IPv4 literal as a domain", body: { domain: "192.168.1.1" } },
      { why: "domain with a leading dot", body: { domain: ".example.com" } },
      { why: "domain with a hyphen-edged label", body: { domain: "-bad.com" } },
      { why: "domain with a space", body: { domain: "exa mple.com" } },
      { why: "domain with an underscore", body: { domain: "under_score.com" } },
      { why: "non-ASCII domain (punycode required)", body: { domain: "münchen.de" } },
      { why: "name that is whitespace only", body: { name: "   " } },
    ];
    for (const c of bad) {
      const id = `bad-${Math.random().toString(36).slice(2, 9)}`;
      const res = await api(
        IDP_BASE,
        "POST",
        "/api/v1/organizations",
        {
          name: `Bad ${id}`,
          slug: id,
          domain: `${id}.test`,
          ...c.body,
        },
        site.bearer
      );
      expect(res.status, `create must refuse: ${c.why}`).toBe(400);
    }

    // The control: the SAME request shape with every field well-formed is
    // still accepted, so the guard refuses malformed input rather than
    // simply refusing everything.
    const okId = `ok-${Math.random().toString(36).slice(2, 9)}`;
    const good = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      { name: `Good ${okId}`, slug: okId, domain: `${okId}.test` },
      site.bearer
    );
    expect(good.status, "a well-formed organization is still created").toBe(201);
  });

  test("field validation on UPDATE: malformed renames are refused, and accepted ones are normalized", async () => {
    // THE-UNVALIDATED-UPDATE (2026-08-31): the create path was guarded but
    // OrganizationService.Update went straight to repo.Update, so
    // PUT {"domain":"lexus"} persisted what POST refuses — and the repository
    // wrote the raw string, so "LEXUS.COM " and "lexus.com" could become two
    // rows. The sweep only ever exercised POST, which is how the gap
    // survived the previous slice's "every create/update path" claim.
    const subjectId = `upd-${Math.random().toString(36).slice(2, 9)}`;
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      { name: `Update Subject ${subjectId}`, slug: subjectId, domain: `${subjectId}.test` },
      site.bearer
    );
    expect(created.status, "subject org created").toBe(201);
    const subject =
      ((created.json as { organization?: { id?: string } }).organization?.id ??
        (created.json as { id?: string }).id) ||
      "";
    expect(subject.length).toBeGreaterThan(0);

    const badUpdates: Array<{ why: string; body: Record<string, unknown> }> = [
      {
        why: "domain with no dot or TLD — THE REPORTED DEFECT, on update",
        body: { domain: "lexus" },
      },
      { why: "single-label domain", body: { domain: "localhost" } },
      { why: "numeric TLD", body: { domain: "example.123" } },
      { why: "IPv4 literal", body: { domain: "192.168.1.1" } },
      { why: "hyphen-edged label", body: { domain: "-bad.com" } },
      { why: "space inside the domain", body: { domain: "exa mple.com" } },
      { why: "non-ASCII domain", body: { domain: "münchen.de" } },
      { why: "name that is whitespace only", body: { name: "   " } },
      { why: "max_sessions_per_user out of range", body: { max_sessions_per_user: 0 } },
      { why: "mfa_policy not a known value", body: { mfa_policy: "sometimes" } },
    ];
    for (const c of badUpdates) {
      const res = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/organizations/${subject}`,
        c.body,
        site.bearer
      );
      expect(res.status, `update must refuse: ${c.why}`).toBe(400);
    }

    // The subject must be UNCHANGED by every refusal above.
    const after = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${subject}`,
      undefined,
      site.bearer
    );
    expect(after.status).toBe(200);
    expect((after.json as { domain?: string }).domain, "no refused update touched the row").toBe(
      `${subjectId}.test`
    );

    // CONTROL: a well-formed rename succeeds AND is stored normalized, so
    // two spellings cannot become two rows.
    const renamed = `${subjectId}-renamed.test`;
    const ok = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${subject}`,
      { domain: `  ${renamed.toUpperCase()}.  ` },
      site.bearer
    );
    expect(ok.status, "a well-formed rename is accepted").toBe(200);
    const reread = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${subject}`,
      undefined,
      site.bearer
    );
    expect(
      (reread.json as { domain?: string }).domain,
      "the accepted rename is stored lowercased, trimmed and without the FQDN dot"
    ).toBe(renamed);
  });

  test("[ORG-SYSTEM-RENAME-FORBIDDEN-1] renaming the SYSTEM organization is 403 forbidden, not 404 not-found", async () => {
    // THE-UNVALIDATED-REST (2026-08-31): AdminPermissionsModel.md says the
    // System organization cannot be renamed, and the service refused it
    // correctly — but the handler collapsed domain.ErrForbidden into its
    // catch-all 404, so site_admin was told a row it can plainly read does
    // not exist. Nothing pinned the status until this test.
    //
    // The System org is NOT in GET /organizations (that surface lists
    // tenants), so the id comes from the domain constant it is created with.
    const SYSTEM_ORG_ID = "00000000-0000-7000-0000-000000000000";

    const renamed = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${SYSTEM_ORG_ID}`,
      { name: "Renamed System" },
      site.bearer
    );
    expect(renamed.status, "renaming the System organization is a REFUSAL, not a miss").toBe(403);

    // The three statuses must stay distinguishable from one another —
    // a 403 that swallowed the other two would pass the line above alone.
    const ghost = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${GHOST}`,
      { name: "Ghost" },
      site.bearer
    );
    expect(ghost.status, "a genuinely absent organization is still 404").toBe(404);

    const malformed = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${SYSTEM_ORG_ID}`,
      { domain: "lexus" },
      site.bearer
    );
    expect(malformed.status, "an invalid field is still 400").toBe(400);
  });

  test("[USER-UPDATE-VALIDATION-1] field validation on user UPDATE: malformed fields are refused with 400, not 500", async () => {
    // THE-UNVALIDATED-REST: UserService.Update validated only the password
    // and handed Email and Role to the repository raw. The users
    // chk_user_email_format CHECK and the user_role ENUM were the only
    // guards, so every one of these MEASURED 500 internal_error — a server
    // fault reported for the caller's own typo.
    const tag = `usr-${Math.random().toString(36).slice(2, 8)}`;
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      {
        email: `${tag}@${runId}-1.test`,
        password: `Us3r!${tag}xQ`,
        name: "Update Subject",
        role: "org_user",
      },
      orgAdmin.bearer
    );
    expect(created.status, "subject user created").toBe(201);
    const uid =
      ((created.json as { user?: { id?: string } }).user?.id ??
        (created.json as { id?: string }).id) ||
      "";
    expect(uid.length).toBeGreaterThan(0);

    for (const c of [
      { why: "email with no @ or domain", body: { email: "not-an-email" } },
      { why: "email that is whitespace only", body: { email: "   " } },
      { why: "email that is empty", body: { email: "" } },
      { why: "role outside the user_role enum", body: { role: "wizard" } },
    ]) {
      const res = await api(IDP_BASE, "PUT", `/api/v1/users/${uid}`, c.body, orgAdmin.bearer);
      expect(res.status, `user update must refuse with 400: ${c.why}`).toBe(400);
    }

    const after = await api(IDP_BASE, "GET", `/api/v1/users/${uid}`, undefined, orgAdmin.bearer);
    expect(after.status).toBe(200);
    const row = (after.json as { user?: Record<string, unknown> }).user ?? after.json;
    expect((row as { email?: string }).email, "no refused update touched the row").toBe(
      `${tag}@${runId}-1.test`
    );
    expect((row as { role?: string }).role, "the role survived every refusal").toBe("org_user");

    // CONTROL: a legitimate change still lands.
    const ok = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${uid}`,
      { name: "Renamed Subject" },
      orgAdmin.bearer
    );
    expect(ok.status, "a well-formed user update is accepted").toBe(200);
  });

  test("[CLIENT-UPDATE-VALIDATION-1] field validation on client UPDATE: a blank name and an empty redirect list are refused, not persisted", async () => {
    // THE-UNVALIDATED-REST: ClientService.UpdateClient checked redirect-URI
    // SHAPE but not the two rules prepareClient enforces at create — a name
    // non-empty after trimming, and AT LEAST ONE redirect URI. Both were
    // measured answering 200 and PERSISTING; an empty list leaves an
    // authorization-code client that can never complete a flow.
    const name = `Client ${Math.random().toString(36).slice(2, 8)}`;
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      { name, redirect_uris: ["https://app.example.test/callback"] },
      orgAdmin.bearer
    );
    expect(created.status, "subject client created").toBe(201);
    const cid =
      ((created.json as { client?: { id?: string } }).client?.id ??
        (created.json as { id?: string }).id) ||
      "";
    expect(cid.length).toBeGreaterThan(0);

    for (const c of [
      { why: "a name that is whitespace only", body: { name: "   " } },
      { why: "an EMPTY redirect-URI list", body: { redirect_uris: [] } },
    ]) {
      const res = await api(IDP_BASE, "PUT", `/api/v1/clients/${cid}`, c.body, orgAdmin.bearer);
      expect(res.status, `client update must refuse: ${c.why}`).toBe(400);
    }

    const after = await api(IDP_BASE, "GET", `/api/v1/clients/${cid}`, undefined, orgAdmin.bearer);
    expect(after.status).toBe(200);
    const row = (after.json as { client?: Record<string, unknown> }).client ?? after.json;
    expect((row as { name?: string }).name, "no refused update touched the name").toBe(name);
    expect(
      ((row as { redirect_uris?: string[] }).redirect_uris ?? []).length,
      "the client still has the redirect URI it needs to complete a flow"
    ).toBe(1);

    // CONTROL: a legitimate change still lands.
    const ok = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${cid}`,
      { name: `${name} Renamed` },
      orgAdmin.bearer
    );
    expect(ok.status, "a well-formed client update is accepted").toBe(200);
  });

  test("[ORG-ROLE-UPDATE-BLANK-1] a blank rename is refused, never a 200 that changes nothing", async () => {
    // THE-SILENT-DROP (2026-08-31): UpdateRoleForActor read
    //   if n := strings.TrimSpace(name); n != "" { role.Name = n }
    // so a blank rename assigned NOTHING, wrote the unchanged row and
    // answered 200 OK. The previous slice's inventory cleared this row as
    // GUARDED on exactly that 200 — which is why this spec asserts the ROW,
    // not just the status: a 200 with an unchanged name must FAIL here.
    const created = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      { name: `auditor-${runId}`, description: "reads audit logs" },
      orgAdmin.bearer
    );
    expect(created.status, "subject role created").toBe(201);
    const roleId =
      ((created.json.role as { id?: string })?.id ?? (created.json as { id?: string }).id) || "";
    expect(roleId.length).toBeGreaterThan(0);
    const rolePath = `/api/v1/organizations/${org1}/roles/${roleId}`;

    for (const blank of ["   ", "\t", ""]) {
      const res = await api(IDP_BASE, "PUT", rolePath, { name: blank }, orgAdmin.bearer);
      expect(res.status, `a blank rename (${JSON.stringify(blank)}) must be refused`).toBe(400);

      // THE ASSERTION THAT WOULD HAVE CAUGHT IT: re-read and prove the row
      // did not quietly stay as it was behind a success status.
      const after = await api(IDP_BASE, "GET", rolePath, undefined, orgAdmin.bearer);
      expect(after.status).toBe(200);
      const row = (after.json.role as Record<string, unknown>) ?? after.json;
      expect(
        (row as { name?: string }).name,
        "the row is unchanged — which is only acceptable BECAUSE the write was refused"
      ).toBe(`auditor-${runId}`);
    }

    // CONTROL: a real rename lands and is trimmed exactly as create trims.
    const renamed = await api(
      IDP_BASE,
      "PUT",
      rolePath,
      { name: `  security-auditor-${runId}  ` },
      orgAdmin.bearer
    );
    expect(renamed.status, "a real rename is accepted").toBe(200);
    const reread = await api(IDP_BASE, "GET", rolePath, undefined, orgAdmin.bearer);
    const rerow = (reread.json.role as Record<string, unknown>) ?? reread.json;
    expect(
      (rerow as { name?: string }).name,
      "the accepted rename is stored trimmed, as the create path trims"
    ).toBe(`security-auditor-${runId}`);

    // And a supplied EMPTY description now clears it — an operation the
    // plain-string form could not express, so it was silently kept.
    const cleared = await api(IDP_BASE, "PUT", rolePath, { description: "" }, orgAdmin.bearer);
    expect(cleared.status, "clearing the description is accepted").toBe(200);
    const afterClear = await api(IDP_BASE, "GET", rolePath, undefined, orgAdmin.bearer);
    const clearedRow = (afterClear.json.role as Record<string, unknown>) ?? afterClear.json;
    expect(
      (clearedRow as { description?: string }).description ?? "",
      "a supplied empty description CLEARS it instead of being silently kept"
    ).toBe("");
  });

  test("[SERVICE-ACCOUNT-UPDATE-BLANK-1] [SCOPE-TEMPLATE-UPDATE-BLANK-1] blank renames are refused on both tenant-owned surfaces", async () => {
    // Same class, two more routes the census MEASURED answering 200 with an
    // unchanged row. The scope-template one was worse: {"name":"   "}
    // answered 200 and STORED the whitespace as the template name, because
    // the shared validator spelled the required-field rule as == "".
    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      { name: `ci-${runId}`, role: "org_user" },
      orgAdmin.bearer
    );
    expect(sa.status, "subject service account created").toBe(201);
    const saId =
      ((sa.json.service_account as { id?: string })?.id ?? (sa.json as { id?: string }).id) || "";
    expect(saId.length).toBeGreaterThan(0);

    for (const blank of ["   ", ""]) {
      const res = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/service-accounts/${saId}`,
        { name: blank },
        orgAdmin.bearer
      );
      expect(res.status, `service-account blank rename (${JSON.stringify(blank)}) refused`).toBe(
        400
      );
      const after = await api(
        IDP_BASE,
        "GET",
        `/api/v1/service-accounts/${saId}`,
        undefined,
        orgAdmin.bearer
      );
      const row = (after.json.service_account as Record<string, unknown>) ?? after.json;
      expect(
        (row as { name?: string }).name,
        "the service account is unchanged BECAUSE it was refused"
      ).toBe(`ci-${runId}`);
    }

    const tpl = await api(
      IDP_BASE,
      "POST",
      "/api/v1/scope-templates",
      { name: `reader-${runId}`, scopes: ["read:things"] },
      orgAdmin.bearer
    );
    expect(tpl.status, "subject scope template created").toBe(201);
    const tplId =
      ((tpl.json.scope_template as { id?: string })?.id ?? (tpl.json as { id?: string }).id) || "";
    expect(tplId.length).toBeGreaterThan(0);

    for (const blank of ["   ", ""]) {
      const res = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/scope-templates/${tplId}`,
        { name: blank },
        orgAdmin.bearer
      );
      expect(res.status, `scope-template blank rename (${JSON.stringify(blank)}) refused`).toBe(
        400
      );
      const after = await api(
        IDP_BASE,
        "GET",
        `/api/v1/scope-templates/${tplId}`,
        undefined,
        orgAdmin.bearer
      );
      const row = (after.json.scope_template as Record<string, unknown>) ?? after.json;
      expect(
        (row as { name?: string }).name,
        "the template kept its real name — whitespace was NOT stored as the name"
      ).toBe(`reader-${runId}`);
    }
  });

  test("[CLIENT-CREATE-VALIDATION-1] client CREATE refuses unlisted protocol values — the mirror of the update guard", async () => {
    // THE-MIRROR (2026-09-01): the update path validated the auth method and
    // signing alg while CREATE assigned both raw, so POST with an unlisted
    // value reached the DB CHECK constraint and returned a flattened error.
    // prepareClient now runs the full document validator, which also brings
    // the cross-field rules that were previously database-only.
    const base = () => ({
      name: `mirror-${Math.random().toString(36).slice(2, 8)}`,
      redirect_uris: ["https://app.example.test/cb"],
    });
    for (const c of [
      { why: "an unlisted auth method", extra: { token_endpoint_auth_method: "wizard" } },
      { why: "an unlisted signing alg", extra: { token_endpoint_auth_signing_alg: "HS256" } },
      {
        why: "a signing alg in the wrong case",
        extra: { token_endpoint_auth_signing_alg: "rs256" },
      },
      {
        why: "jwks_uri on a non-private_key_jwt client (was a flattened DB refusal)",
        extra: { jwks_uri: "https://app.example.test/jwks.json" },
      },
      {
        why: "private_key_jwt with no key source",
        extra: { token_endpoint_auth_method: "private_key_jwt" },
      },
    ]) {
      const res = await api(
        IDP_BASE,
        "POST",
        "/api/v1/clients",
        { ...base(), ...c.extra },
        orgAdmin.bearer
      );
      expect(res.status, `client create must refuse ${c.why}`).toBe(400);
    }

    // CONTROLS: listed values still create — including the private_key_jwt
    // shape with exactly one key source, which the census once measured
    // failing only at the database.
    const okPlain = await api(IDP_BASE, "POST", "/api/v1/clients", base(), orgAdmin.bearer);
    expect(okPlain.status, "a defaults-only client is still created").toBe(201);
    const okPkj = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      {
        ...base(),
        token_endpoint_auth_method: "private_key_jwt",
        jwks_uri: "https://app.example.test/jwks.json",
      },
      orgAdmin.bearer
    );
    expect(okPkj.status, "a private_key_jwt client with one key source is created").toBe(201);
  });

  test("[CLIENT-UPDATE-DOCUMENT-1] an update that would leave an inconsistent document is refused by the service", async () => {
    // THE-INCONSISTENT-DOCUMENT (2026-09-01): update validated fields, not
    // the document, so these three transitions were refused only by a DB
    // CHECK answering a flattened 400. The service now validates the UPDATED
    // document with the same Client.Validate create runs.
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      {
        name: `doc-${runId}`,
        redirect_uris: ["https://app.example.test/cb"],
        token_endpoint_auth_method: "client_secret_basic",
      },
      orgAdmin.bearer
    );
    expect(created.status, "subject client created").toBe(201);
    const cid =
      ((created.json.client as { id?: string })?.id ?? (created.json as { id?: string }).id) || "";
    expect(cid.length).toBeGreaterThan(0);
    const readClient = async () => {
      const r = await api(IDP_BASE, "GET", `/api/v1/clients/${cid}`, undefined, orgAdmin.bearer);
      expect(r.status).toBe(200);
      return (r.json.client as Record<string, unknown>) ?? (r.json as Record<string, unknown>);
    };

    for (const c of [
      {
        why: "private_key_jwt with no key source",
        body: { token_endpoint_auth_method: "private_key_jwt" },
      },
      { why: "method none while confidential", body: { token_endpoint_auth_method: "none" } },
      {
        why: "jwks material on a secret-based client",
        body: { jwks_uri: "https://app.example.test/jwks.json" },
      },
    ]) {
      const res = await api(IDP_BASE, "PUT", `/api/v1/clients/${cid}`, c.body, orgAdmin.bearer);
      expect(res.status, `the inconsistent document must be refused: ${c.why}`).toBe(400);
      const row = await readClient();
      expect(
        (row as { token_endpoint_auth_method?: string }).token_endpoint_auth_method,
        "no refusal moved the stored method"
      ).toBe("client_secret_basic");
    }

    // CONTROL: the same transition done COHERENTLY lands — method and key
    // source in one PUT.
    const ok = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${cid}`,
      {
        token_endpoint_auth_method: "private_key_jwt",
        jwks_uri: "https://app.example.test/jwks.json",
      },
      orgAdmin.bearer
    );
    expect(ok.status, "the coherent pkj switch is accepted").toBe(200);
    const after = await readClient();
    expect(
      (after as { token_endpoint_auth_method?: string }).token_endpoint_auth_method,
      "the coherent switch landed"
    ).toBe("private_key_jwt");
  });

  test("[CLIENT-UPDATE-BLANK-FIELDS-1] a blank client field clears or is refused, per field — never dropped", async () => {
    // THE-SILENT-DROP-2: five fields were still plain strings, so a supplied
    // blank was indistinguishable from absent and answered 200 unchanged.
    // The answer differs per field, and the reason is what the column can
    // hold: the nullable ones CLEAR, the NOT NULL ones with a CHECK
    // allow-list are REFUSED because the repository would otherwise store
    // the column default nobody asked for.
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      {
        name: `blanks-${runId}`,
        redirect_uris: ["https://app.example.test/cb"],
        scope: "read write",
        token_endpoint_auth_method: "client_secret_post",
        token_endpoint_auth_signing_alg: "RS256",
      },
      orgAdmin.bearer
    );
    expect(created.status, "subject client created").toBe(201);
    const cid =
      ((created.json.client as { id?: string })?.id ?? (created.json as { id?: string }).id) || "";
    expect(cid.length).toBeGreaterThan(0);
    const readClient = async () => {
      const r = await api(IDP_BASE, "GET", `/api/v1/clients/${cid}`, undefined, orgAdmin.bearer);
      expect(r.status).toBe(200);
      return (r.json.client as Record<string, unknown>) ?? (r.json as Record<string, unknown>);
    };

    // CLEARS: the blank must actually land, so the row CHANGES.
    const beforeClear = await readClient();
    expect((beforeClear as { scope?: string }).scope, "precondition: the scope is set").toBe(
      "read write"
    );
    const cleared = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${cid}`,
      { scope: "" },
      orgAdmin.bearer
    );
    expect(cleared.status, "clearing scope is accepted").toBe(200);
    const afterClear = await readClient();
    expect(
      (afterClear as { scope?: string }).scope ?? "",
      "the supplied blank CLEARED the scope instead of being dropped"
    ).toBe("");

    // REFUSED: blank, and any value outside the allow-list. The row must be
    // untouched afterwards — here an unchanged row is correct BECAUSE the
    // write was refused.
    for (const c of [
      { why: "a blank auth method", body: { token_endpoint_auth_method: "" } },
      { why: "a blank signing alg", body: { token_endpoint_auth_signing_alg: "" } },
      { why: "an unlisted auth method", body: { token_endpoint_auth_method: "banana" } },
      { why: "an unlisted signing alg", body: { token_endpoint_auth_signing_alg: "HS256" } },
    ]) {
      const res = await api(IDP_BASE, "PUT", `/api/v1/clients/${cid}`, c.body, orgAdmin.bearer);
      expect(res.status, `client update must refuse ${c.why}`).toBe(400);
    }
    const afterRefusals = await readClient();
    expect(
      (afterRefusals as { token_endpoint_auth_method?: string }).token_endpoint_auth_method,
      "no refusal moved the client onto the column default"
    ).toBe("client_secret_post");

    // CONTROL: a listed value is still accepted.
    const ok = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${cid}`,
      { token_endpoint_auth_method: "client_secret_basic" },
      orgAdmin.bearer
    );
    expect(ok.status, "a listed auth method is accepted").toBe(200);
    const afterOk = await readClient();
    expect(
      (afterOk as { token_endpoint_auth_method?: string }).token_endpoint_auth_method,
      "the accepted method landed"
    ).toBe("client_secret_basic");
  });

  test("[DESCRIPTION-BLANK-UNIFORM-1] a blank description clears identically on every surface", async () => {
    // The previous slice shipped two answers to one request: a whitespace
    // description CLEARED an org role and was STORED as "   " on a service
    // account. Both surfaces are driven with the SAME value here and their
    // results compared, which is the assertion that catches a divergence.
    const role = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      { name: `desc-role-${runId}`, description: "original text" },
      orgAdmin.bearer
    );
    expect(role.status, "subject role created").toBe(201);
    const roleId =
      ((role.json.role as { id?: string })?.id ?? (role.json as { id?: string }).id) || "";

    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      { name: `desc-sa-${runId}`, role: "org_user", description: "original text" },
      orgAdmin.bearer
    );
    expect(sa.status, "subject service account created").toBe(201);
    const saId =
      ((sa.json.service_account as { id?: string })?.id ?? (sa.json as { id?: string }).id) || "";

    for (const supplied of ["   ", ""]) {
      const rRole = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/organizations/${org1}/roles/${roleId}`,
        { description: supplied },
        orgAdmin.bearer
      );
      expect(rRole.status, "org role accepts a description clear").toBe(200);
      const rSa = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/service-accounts/${saId}`,
        { description: supplied },
        orgAdmin.bearer
      );
      expect(rSa.status, "service account accepts a description clear").toBe(200);

      const roleRow = await api(
        IDP_BASE,
        "GET",
        `/api/v1/organizations/${org1}/roles/${roleId}`,
        undefined,
        orgAdmin.bearer
      );
      const saRow = await api(
        IDP_BASE,
        "GET",
        `/api/v1/service-accounts/${saId}`,
        undefined,
        orgAdmin.bearer
      );
      const roleDesc =
        (
          ((roleRow.json.role as Record<string, unknown>) ?? roleRow.json) as {
            description?: string;
          }
        ).description ?? "";
      const saDesc =
        (
          ((saRow.json.service_account as Record<string, unknown>) ?? saRow.json) as {
            description?: string;
          }
        ).description ?? "";

      expect(roleDesc, `org role: ${JSON.stringify(supplied)} clears the description`).toBe("");
      expect(saDesc, `service account: ${JSON.stringify(supplied)} clears the description`).toBe(
        ""
      );
      expect(saDesc, "the two surfaces AGREE — this is what diverged before").toBe(roleDesc);
    }
  });

  test("[REQUIRED-NAME-NOT-WHITESPACE-1] a whitespace name is refused where an empty one already was", async () => {
    // The census found the same field answering three different ways
    // depending only on how much whitespace was typed: on api-resources
    // {"name":""} was a correct 400 while {"name":"   "} answered 200 AND
    // STORED "   ". Both shapes must now agree.
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/api-resources",
      {
        name: `billing-${runId}`,
        audience: `https://billing-${runId}.test`,
        token_ttl_secs: 3600,
      },
      orgAdmin.bearer
    );
    expect(created.status, "subject api resource created").toBe(201);
    const resId =
      ((created.json.api_resource as { id?: string })?.id ??
        (created.json as { id?: string }).id) ||
      "";
    expect(resId.length).toBeGreaterThan(0);

    for (const c of [
      { why: "whitespace name", body: { name: "   ", audience: `https://billing-${runId}.test` } },
      { why: "empty name", body: { name: "", audience: `https://billing-${runId}.test` } },
      { why: "whitespace audience", body: { name: `billing-${runId}`, audience: "   " } },
      { why: "empty audience", body: { name: `billing-${runId}`, audience: "" } },
    ]) {
      const res = await api(
        IDP_BASE,
        "PUT",
        `/api/v1/api-resources/${resId}`,
        { ...c.body, token_ttl_secs: 3600 },
        orgAdmin.bearer
      );
      expect(res.status, `api-resource ${c.why} must be refused`).toBe(400);
    }

    const after = await api(
      IDP_BASE,
      "GET",
      `/api/v1/api-resources/${resId}`,
      undefined,
      orgAdmin.bearer
    );
    const row = (after.json.api_resource as Record<string, unknown>) ?? after.json;
    expect((row as { name?: string }).name, "no refusal stored whitespace as the name").toBe(
      `billing-${runId}`
    );
  });

  test("domains: add, primary, verify, delete — and their error branches", async () => {
    // ROW POST /organizations/:id/domains (SM)
    const add = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains`,
      { domain: `extra-${runId}.test` },
      orgAdmin.bearer
    );
    expect(add.status, "domain add → 201").toBe(201);
    const domId = (add.json.organization_domain as { id?: string })?.id ?? "";
    expect(domId.length).toBeGreaterThan(0);
    expect(
      (add.json.verification_token as string).length,
      "add returns the verification token + TXT record pair"
    ).toBeGreaterThan(0);
    const addBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains`,
      {},
      orgAdmin.bearer
    );
    expect(addBad.status, "domain add without a domain → 400").toBe(400);

    // ROW POST .../domains/:domain_id/primary (SM)
    const primary = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/primary`,
      {},
      orgAdmin.bearer
    );
    expect(primary.status, "set primary → 200").toBe(200);

    // ROW POST .../domains/:domain_id/verify (D) — MEASURED: the DNS TXT
    // lookup for a .test domain fails wholesale, so the live answer is 503
    // "dns lookup failed". The 200 branch needs real DNS the environment
    // cannot build — recorded as unreachable in the wiki.
    const verify = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/verify`,
      {},
      orgAdmin.bearer
    );
    expect(verify.status, "verify on a .test domain → 503 (dns lookup failed)").toBe(503);
    expect(verify.json.error).toBe("dns lookup failed");

    // ROW DELETE .../domains/:domain_id (D)
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/domains/${domId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(del.status, "domain delete → 200").toBe(200);
    const delAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/domains/${domId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAgain.status, "second domain delete → 404").toBe(404);
    const primaryGone = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/primary`,
      {},
      orgAdmin.bearer
    );
    expect(primaryGone.status, "primary on a deleted domain → 404").toBe(404);
  });

  test("identity provider: full CRUD and its error branches", async () => {
    // ROW GET /organizations/:id/identity-provider (SR) — 404 before create.
    const getBefore = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(getBefore.status, "get with none configured → 404").toBe(404);

    // ROW POST /organizations/:id/identity-provider (SM)
    const createBadType = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/identity-provider`,
      { type: "carrier-pigeon", name: "x", slug: "x", config: {} },
      orgAdmin.bearer
    );
    expect(createBadType.status, "create with an unknown type → 400").toBe(400);
    const create = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/identity-provider`,
      {
        type: "oidc",
        name: "Sweep IdP",
        slug: `sweep-${runId}`,
        config: {
          issuer_url: "https://accounts.example.test",
          client_id: "sweep-client",
          client_secret: "sweep-secret-not-real",
          redirect_uris: ["https://ui.example.test/callback"],
        },
      },
      orgAdmin.bearer
    );
    expect(create.status, "create OIDC provider → 201").toBe(201);

    const get = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(get.status, "get configured provider → 200").toBe(200);

    // ROW PUT /organizations/:id/identity-provider (SM) — a PUT is the whole
    // document: name-only is refused on the issuer validation, full passes.
    const updateBad = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/identity-provider`,
      { name: "Sweep IdP 2" },
      orgAdmin.bearer
    );
    expect(updateBad.status, "name-only update → 400 (issuer required)").toBe(400);
    const update = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/identity-provider`,
      {
        type: "oidc",
        name: "Sweep IdP 2",
        slug: `sweep-${runId}`,
        config: {
          issuer_url: "https://accounts.example.test",
          client_id: "sweep-client",
          client_secret: "sweep-secret-not-real",
          redirect_uris: ["https://ui.example.test/callback"],
        },
      },
      orgAdmin.bearer
    );
    expect(update.status, "full-document update → 200").toBe(200);

    // ROW DELETE /organizations/:id/identity-provider (D)
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(del.status, "delete provider → 200").toBe(200);
    const delAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAgain.status, "second delete → 404").toBe(404);
  });

  test("protocol settings: upsert and its refusals", async () => {
    // ROW PUT /organizations/:id/protocol-settings (SM). THE-REMAINING-FOUR
    // (2026-08-30): protocol-settings are the org's own org_admin's — the
    // org_admin does the upsert; site_admin is now REFUSED (403).
    const put = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      { dynamic_client_registration_enabled: true, scim_enabled: false },
      orgAdmin.bearer
    );
    expect(put.status, "org_admin upsert of OWN org → 200").toBe(200);
    expect(put.json.source, "explicit settings report their source").toBe("explicit");
    const putEmpty = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      {},
      orgAdmin.bearer
    );
    expect(putEmpty.status, "empty upsert → 400 (both fields required)").toBe(400);
    const putSiteAdmin = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      { dynamic_client_registration_enabled: false, scim_enabled: false },
      site.bearer
    );
    expect(
      putSiteAdmin.status,
      "site_admin upsert of a tenant's settings → 403 (model forbids)"
    ).toBe(403);
  });

  test("org roles + scopes: full CRUD and error branches", async () => {
    // THE-INVERTED-GUARD: api-resources answer to the org's own org_admin.
    const resource = await api(
      IDP_BASE,
      "POST",
      "/api/v1/api-resources",
      {
        organization_id: org1,
        name: `sweep-res-${runId}`,
        audience: `https://api.${runId}.test`,
        token_ttl_secs: 3600,
        scopes: [{ Name: "read" }],
      },
      orgAdmin.bearer
    );
    expect(resource.status, "api-resource for scope binding → 201").toBe(201);
    const resId = (resource.json.api_resource as { id?: string })?.id ?? "";
    expect(resId.length).toBeGreaterThan(0);

    // ROW POST /organizations/:id/roles (SM)
    const role = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      { name: `sweep-role-${runId}` },
      orgAdmin.bearer
    );
    expect(role.status, "role create → 201").toBe(201);
    const roleId = (role.json.id as string) ?? "";
    expect(roleId.length).toBeGreaterThan(0);
    const roleBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      {},
      orgAdmin.bearer
    );
    expect(roleBad.status, "role create without a name → 400").toBe(400);

    // ROW GET /organizations/:id/roles/:role_id (SR)
    const get = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(get.status, "role get → 200").toBe(200);

    // ROW PUT /organizations/:id/roles/:role_id (SM)
    const update = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      { name: `sweep-role2-${runId}` },
      orgAdmin.bearer
    );
    expect(update.status, "role update → 200").toBe(200);

    // ROW POST .../roles/:role_id/scopes (SM)
    const scopeAdd = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes`,
      { resource_id: resId, scope_name: "read" },
      orgAdmin.bearer
    );
    expect(scopeAdd.status, "scope add → 200").toBe(200);
    // MEASURED: an empty body BINDS (zero UUID) and fails on resource
    // ownership first — 403, not 400.
    const scopeAddBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes`,
      {},
      orgAdmin.bearer
    );
    expect(scopeAddBad.status, "scope add with empty body → 403 (zero UUID not owned)").toBe(403);

    // ROW DELETE .../roles/:role_id/scopes/:scope_name (D)
    const scopeDel = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes/read`,
      undefined,
      orgAdmin.bearer
    );
    expect(scopeDel.status, "scope remove → 200").toBe(200);

    // ROW DELETE /organizations/:id/roles/:role_id (D)
    const roleDel = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(roleDel.status, "role delete → 200").toBe(200);
    const getGone = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(getGone.status, "role get after delete → 404").toBe(404);
    const updateGone = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      { name: "ghost" },
      orgAdmin.bearer
    );
    expect(updateGone.status, "role update after delete → 404").toBe(404);
    const roleDelAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(roleDelAgain.status, "second role delete → 404").toBe(404);
    const scopeDelGone = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes/read`,
      undefined,
      orgAdmin.bearer
    );
    expect(scopeDelGone.status, "scope remove on a deleted role → 404").toBe(404);
  });

  test("service accounts: create, bundle, refusals", async () => {
    // ROW POST /organizations/:id/service-accounts (SM)
    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      { name: `sweep-sa-${runId}` },
      orgAdmin.bearer
    );
    expect(sa.status, "service-account create → 201").toBe(201);
    const saBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      {},
      orgAdmin.bearer
    );
    expect(saBad.status, "service-account create without a name → 400").toBe(400);

    // ROW POST /organizations/:id/service-accounts/with-client (SM)
    const bundle = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts/with-client`,
      {
        service_account: { name: `sweep-sab-${runId}` },
        client: { name: `sweep-sab-client-${runId}` },
      },
      orgAdmin.bearer
    );
    expect(bundle.status, "bundle create → 201").toBe(201);
    const bundleBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts/with-client`,
      {},
      orgAdmin.bearer
    );
    expect(bundleBad.status, "bundle create with empty body → 400").toBe(400);
  });

  test("lifecycle: delete, restore, and the reads — with their refusals", async () => {
    const c2 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      { name: `sweep2 ${runId}`, slug: `${runId}-2`, domain: `${runId}-2.test`, active: true },
      site.bearer
    );
    expect(c2.status).toBe(201);
    const org2 = (c2.json.id as string) ?? (c2.json.organization as { id?: string })?.id ?? "";
    expect(org2.length).toBeGreaterThan(0);

    // ROW DELETE /organizations/:id (D)
    const delAsOrgAdmin = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org2}`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAsOrgAdmin.status, "org delete by org_admin (other org) → 403").toBe(403);
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org2}`,
      undefined,
      site.bearer
    );
    expect(del.status, "org soft-delete → 200").toBe(200);

    // ROW POST /organizations/:id/restore (D)
    const restore = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org2}/restore`,
      {},
      site.bearer
    );
    expect(restore.status, "org restore → 200").toBe(200);
    const restoreAgain = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org2}/restore`,
      {},
      site.bearer
    );
    expect(restoreAgain.status, "restore of a live org → 404 (nothing deleted to restore)").toBe(
      404
    );
    const delGhost = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${GHOST}`,
      undefined,
      site.bearer
    );
    expect(delGhost.status, "delete of a nonexistent org → 404").toBe(404);

    // ROW resend-activation error branch: an ACTIVE org refuses re-issue.
    const resendActive = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/resend-activation`,
      {},
      site.bearer
    );
    expect(resendActive.status, "resend-activation on an active org → 409").toBe(409);

    // ROW GET /organizations/:id/admin-recovery-candidates (SR)
    const rec = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/admin-recovery-candidates`,
      undefined,
      site.bearer
    );
    expect(rec.status, "recovery candidates → 200").toBe(200);
    const recBad = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/not-a-uuid/admin-recovery-candidates",
      undefined,
      site.bearer
    );
    expect(recBad.status, "recovery candidates with a malformed id → 400").toBe(400);

    // ROW GET /organizations/export-candidates (SR)
    const exp = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/export-candidates",
      undefined,
      site.bearer
    );
    expect(exp.status, "export candidates (site_admin) → 200").toBe(200);
    const expOrgAdmin = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/export-candidates",
      undefined,
      orgAdmin.bearer
    );
    expect(expOrgAdmin.status, "export candidates (org_admin) → 200, tenant-scoped").toBe(200);
    expect(
      (expOrgAdmin.json.organizations as unknown[]).length,
      "org_admin sees exactly their own org"
    ).toBe(1);
    const expNoAuth = await api(IDP_BASE, "GET", "/api/v1/organizations/export-candidates");
    expect(expNoAuth.status, "export candidates unauthenticated → 401").toBe(401);
  });
});
