/**
 * AYGHU-2 ADMIN API (2026-09-02) — agent-communication authorizations sweep.
 *
 * The four new census rows of /api/v1/agent-communication-authorizations
 * (create, list, get, revoke), every (endpoint, role) cell observed inside
 * this run so the role-matrix phase can count them: org_admin (own-org happy
 * path + the refusal branches), site_admin (403, uniform — platform
 * administration never becomes tenant ownership) and org_user (403).
 * Cross-tenant: org_admin of B against A's authorization answers 404 —
 * byte-identical to an absent id (no existence oracle).
 *
 * Measured statuses pinned:
 *  - a private_key_jwt client bound to a service account needs ≥1
 *    redirect_uri (Client.Validate) even though it never redirects;
 *  - client-supplied id / session_id / aci / policy_digest are ignored:
 *    the response carries server-allocated values;
 *  - revoke is terminal + idempotent: the second call returns the first
 *    stamp unchanged (same revoked_at), and a later reason never overwrites.
 *
 * Session sharing: one site_admin login, one activated org_admin per org,
 * one org_user in A. Serial by --workers=1.
 */
import { expect, test } from "@playwright/test";
import { api, firstLoginBearerAsync } from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST = "00000000-0000-0000-0000-00000000dead";
const BASE = "/api/v1/agent-communication-authorizations";

// RFC 7638 JWK thumbprint of an RSA public JWK (members e, kty, n in
// lexicographic order, no whitespace), base64url without padding.
async function rsaThumbprint(jwk: { e?: string; kty?: string; n?: string }): Promise<string> {
  const { createHash } = await import("node:crypto");
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return createHash("sha256").update(canonical).digest("base64url");
}

test.describe.configure({ mode: "serial" });

test.describe("agent-communication authorizations sweep (4 rows × 3 roles, cross-tenant 404)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  const A = { id: "", bearer: "" };
  const B = { id: "", bearer: "" };
  let userA = { bearer: "" };
  let runId = "";
  type Agent = { saId: string; clientId: string; thumbprint: string };
  const agentsA: Agent[] = [];
  const agentsB: Agent[] = [];
  let authA = "";
  let authB = "";
  let firstRevokedAt = "";

  const mkOrg = async (n: string) => {
    const c = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `${n} ${runId}`,
        slug: `${runId}-${n}`,
        domain: `${runId}-${n}.test`,
        admin_email: `admin@${runId}-${n}.test`,
      },
      site.bearer
    );
    expect(c.status, `create org ${n} → 201`).toBe(201);
    const id = (c.json.organization as { id?: string })?.id ?? "";
    const rs = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${id}/resend-activation`,
      {},
      site.bearer
    );
    const pw = `Adm!${runId}${n}9wqX`;
    await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: (rs.json as { activation_token?: string }).activation_token,
      password: pw,
    });
    const admin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}-${n}.test`, pw);
    return { id, bearer: admin.bearer };
  };

  // An agent identity: a service account of the org (owned by the creating
  // org_admin) installed as a private_key_jwt OAuth client bound to it.
  const mkAgent = async (name: string, orgId: string, bearer: string): Promise<Agent> => {
    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgId}/service-accounts`,
      { name: `${name}-${runId}`, description: "AYGHU e2e agent identity" },
      bearer
    );
    expect(sa.status, `create service account ${name} → 201`).toBe(201);
    const saId = sa.json.id as string;
    const { generateKeyPairSync } = await import("node:crypto");
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as { e?: string; kty?: string; n?: string };
    const cl = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      {
        name: `${name}-client-${runId}`,
        organization_id: orgId,
        service_account_id: saId,
        redirect_uris: [`https://${name}.${runId}.test/cb`],
        scope: "openid",
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_signing_alg: "RS256",
        jwks: JSON.stringify({ keys: [{ ...jwk, kid: `${name}-k1`, alg: "RS256", use: "sig" }] }),
      },
      bearer
    );
    expect(cl.status, `create private_key_jwt client for ${name} → 201`).toBe(201);
    const clientId = (cl.json.client as { client_id?: string })?.client_id ?? "";
    expect(clientId.length, "client_id present").toBeGreaterThan(0);
    return { saId, clientId, thumbprint: await rsaThumbprint(jwk) };
  };

  const createBody = (agents: Agent[], overrides: Record<string, unknown> = {}) => ({
    relay_audience: `https://relay.${runId}.test/session`,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    max_messages: 20,
    max_message_size_bytes: 8192,
    participants: [
      {
        service_account_id: agents[0].saId,
        client_id: agents[0].clientId,
        role: "initiator",
        proof_key_thumbprint: agents[0].thumbprint,
        capabilities: ["repository.read", "communication.discuss", "repository.read"],
      },
      {
        service_account_id: agents[1].saId,
        client_id: agents[1].clientId,
        role: "responder",
        proof_key_thumbprint: agents[1].thumbprint,
        capabilities: [],
      },
    ],
    ...overrides,
  });

  test("setup: shared session, two tenant orgs, two agent identities each, an org_user in A", async () => {
    test.setTimeout(180_000);
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length, "harness must export the bootstrap password").toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `ayghu-${Date.now().toString(36)}`;
    const a = await mkOrg("a");
    A.id = a.id;
    A.bearer = a.bearer;
    const b = await mkOrg("b");
    B.id = b.id;
    B.bearer = b.bearer;

    agentsA.push(
      await mkAgent("agent-a1", A.id, A.bearer),
      await mkAgent("agent-a2", A.id, A.bearer)
    );
    agentsB.push(
      await mkAgent("agent-b1", B.id, B.bearer),
      await mkAgent("agent-b2", B.id, B.bearer)
    );

    const userEmail = `u@${runId}-a.test`;
    const userPw = `Usr!${runId}3kpZ`;
    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: userEmail, password: userPw, role: "org_user", organization_id: A.id },
      A.bearer
    );
    expect(uc.status, "create org_user in A → 201").toBe(201);
    await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${uc.json.id as string}`,
      { email_verified: true },
      A.bearer
    );
    userA = await firstLoginBearerAsync(IDP_BASE, userEmail, userPw);
    expect(userA.bearer.length, "org_user bearer").toBeGreaterThan(0);
  });

  test("ROW create: org_admin own-org → 201 with server-allocated ids, ACIs and digest; client-supplied server fields ignored", async () => {
    const body = createBody(agentsA, {
      id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      policy_digest: "deadbeef",
      owner_id: GHOST,
    });
    (body.participants[0] as Record<string, unknown>).aci = "00000000-0000-0000-0000-000000000003";
    const r = await api(IDP_BASE, "POST", BASE, body, A.bearer);
    expect(r.status, `create → 201 (${JSON.stringify(r.json)})`).toBe(201);
    const j = r.json as Record<string, unknown>;
    authA = j.id as string;
    expect(authA).not.toBe("00000000-0000-0000-0000-000000000001");
    expect(j.session_id).not.toBe("00000000-0000-0000-0000-000000000002");
    expect(j.policy_digest, "server-computed SHA-256 hex").toMatch(/^[0-9a-f]{64}$/);
    expect(j.policy_digest).not.toBe("deadbeef");
    expect(j.owner_id, "the owner is the acting org_admin, never the supplied value").not.toBe(
      GHOST
    );
    expect(j.organization_id).toBe(A.id);
    expect(j.status).toBe("active");
    expect(j.policy_version).toBe("v1");
    const parts = j.participants as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    const acis = new Set(parts.map((p) => p.aci as string));
    expect(acis.size, "two distinct ACIs").toBe(2);
    expect(acis.has("00000000-0000-0000-0000-000000000003")).toBe(false);
    const initiator = parts.find((p) => p.role === "initiator") as Record<string, unknown>;
    expect(initiator.capabilities, "capabilities stored canonical (sorted, deduplicated)").toEqual([
      "communication.discuss",
      "repository.read",
    ]);
    expect(initiator.service_account_id).toBe(agentsA[0].saId);
    for (const forbidden of ["client_secret", "private_key", "jwks", "access_token"]) {
      expect(j, `no ${forbidden} in the response`).not.toHaveProperty(forbidden);
      for (const p of parts) expect(p).not.toHaveProperty(forbidden);
    }
  });

  test("ROW create refusals: one participant 400, unknown capability 400, duplicate role 400, foreign organization 403", async () => {
    const one = createBody(agentsA);
    one.participants = one.participants.slice(0, 1);
    const r1 = await api(IDP_BASE, "POST", BASE, one, A.bearer);
    expect(r1.status).toBe(400);
    expect(r1.json.reason).toBe("participant_count");

    const cap = createBody(agentsA);
    (cap.participants[0] as { capabilities: string[] }).capabilities = [
      "repository.read",
      "repository.delete",
    ];
    const r2 = await api(IDP_BASE, "POST", BASE, cap, A.bearer);
    expect(r2.status).toBe(400);
    expect(r2.json.reason).toBe("unknown_capability");

    const dup = createBody(agentsA);
    (dup.participants[1] as { role: string }).role = "initiator";
    const r3 = await api(IDP_BASE, "POST", BASE, dup, A.bearer);
    expect(r3.status).toBe(400);
    expect(r3.json.reason).toBe("duplicate_role");

    const foreignOrg = await api(
      IDP_BASE,
      "POST",
      BASE,
      createBody(agentsA, { organization_id: B.id }),
      A.bearer
    );
    expect(foreignOrg.status, "an explicit foreign organization → 403").toBe(403);

    // B's agents are another organization's: indistinguishable from absent.
    const foreignSA = await api(
      IDP_BASE,
      "POST",
      BASE,
      createBody([agentsB[0], agentsA[1]]),
      A.bearer
    );
    expect(foreignSA.status).toBe(400);
    expect(foreignSA.json.reason).toBe("participant_service_account_not_found");
    const absentSA = await api(
      IDP_BASE,
      "POST",
      BASE,
      createBody([{ ...agentsA[0], saId: GHOST }, agentsA[1]]),
      A.bearer
    );
    expect(absentSA.status).toBe(foreignSA.status);
    expect(absentSA.json).toEqual(foreignSA.json);
  });

  test("ROW list + get: own-org → 200; cross-tenant get → 404 identical to an absent id", async () => {
    const list = await api(IDP_BASE, "GET", BASE, undefined, A.bearer);
    expect(list.status).toBe(200);
    expect(list.json.count).toBe(1);
    const ids = (list.json.authorizations as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toEqual([authA]);

    const get = await api(IDP_BASE, "GET", `${BASE}/${authA}`, undefined, A.bearer);
    expect(get.status).toBe(200);
    expect(get.json.id).toBe(authA);

    // B has its own authorization and sees only it.
    const bCreate = await api(IDP_BASE, "POST", BASE, createBody(agentsB), B.bearer);
    expect(bCreate.status, "B creates its own → 201").toBe(201);
    authB = bCreate.json.id as string;
    const bList = await api(IDP_BASE, "GET", BASE, undefined, B.bearer);
    expect(bList.status).toBe(200);
    expect((bList.json.authorizations as Array<{ id: string }>).map((x) => x.id)).toEqual([authB]);

    const foreign = await api(IDP_BASE, "GET", `${BASE}/${authA}`, undefined, B.bearer);
    const absent = await api(IDP_BASE, "GET", `${BASE}/${GHOST}`, undefined, B.bearer);
    expect(foreign.status, "cross-tenant read → 404").toBe(404);
    expect(absent.status).toBe(foreign.status);
    expect(absent.json).toEqual(foreign.json);
    const malformed = await api(IDP_BASE, "GET", `${BASE}/not-a-uuid`, undefined, A.bearer);
    expect(malformed.status).toBe(400);
  });

  test("ROW revoke: cross-tenant → 404 identical to absent; own → 200 terminal + idempotent; oversized reason 400", async () => {
    const foreign = await api(
      IDP_BASE,
      "POST",
      `${BASE}/${authA}/revoke`,
      { reason: "probe" },
      B.bearer
    );
    const absent = await api(
      IDP_BASE,
      "POST",
      `${BASE}/${GHOST}/revoke`,
      { reason: "probe" },
      B.bearer
    );
    expect(foreign.status, "cross-tenant revoke → 404").toBe(404);
    expect(absent.status).toBe(foreign.status);
    expect(absent.json).toEqual(foreign.json);
    const stillActive = await api(IDP_BASE, "GET", `${BASE}/${authA}`, undefined, A.bearer);
    expect(stillActive.json.status, "the cross-tenant probe changed nothing").toBe("active");

    const long = await api(
      IDP_BASE,
      "POST",
      `${BASE}/${authA}/revoke`,
      { reason: "x".repeat(257) },
      A.bearer
    );
    expect(long.status).toBe(400);
    expect(long.json.reason).toBe("revocation_reason_too_long");

    const rev = await api(
      IDP_BASE,
      "POST",
      `${BASE}/${authA}/revoke`,
      { reason: "  e2e sweep  " },
      A.bearer
    );
    expect(rev.status, `revoke → 200 (${JSON.stringify(rev.json)})`).toBe(200);
    expect(rev.json.status).toBe("revoked");
    expect(rev.json.revocation_reason).toBe("e2e sweep");
    firstRevokedAt = rev.json.revoked_at as string;
    expect(firstRevokedAt.length).toBeGreaterThan(0);

    const again = await api(
      IDP_BASE,
      "POST",
      `${BASE}/${authA}/revoke`,
      { reason: "later" },
      A.bearer
    );
    expect(again.status, "repeat is idempotent").toBe(200);
    expect(again.json.revoked_at).toBe(firstRevokedAt);
    expect(again.json.revocation_reason, "a later reason never overwrites the first stamp").toBe(
      "e2e sweep"
    );

    const noBody = await api(IDP_BASE, "POST", `${BASE}/${authB}/revoke`, undefined, B.bearer);
    expect(noBody.status, "revoke without a body → 200").toBe(200);
    expect(noBody.json.status).toBe("revoked");
    expect(noBody.json).not.toHaveProperty("revocation_reason");
  });

  test("ROLES: site_admin and org_user are refused 403 on all four routes — uniformly, whatever the target", async () => {
    for (const [who, bearer] of [
      ["site_admin", site.bearer],
      ["org_user", userA.bearer],
    ] as const) {
      const create = await api(IDP_BASE, "POST", BASE, createBody(agentsA), bearer);
      expect(create.status, `${who} create → 403`).toBe(403);
      const list = await api(IDP_BASE, "GET", BASE, undefined, bearer);
      expect(list.status, `${who} list → 403`).toBe(403);
      const getOwn = await api(IDP_BASE, "GET", `${BASE}/${authA}`, undefined, bearer);
      const getAbsent = await api(IDP_BASE, "GET", `${BASE}/${GHOST}`, undefined, bearer);
      expect(getOwn.status, `${who} get → 403`).toBe(403);
      expect(
        getAbsent.status,
        `${who} get absent → 403 (caller-dependent, not target-dependent)`
      ).toBe(403);
      const revoke = await api(IDP_BASE, "POST", `${BASE}/${authB}/revoke`, {}, bearer);
      expect(revoke.status, `${who} revoke → 403`).toBe(403);
    }
    const anon = await api(IDP_BASE, "GET", BASE);
    expect(anon.status, "no bearer → 401").toBe(401);
  });
});
