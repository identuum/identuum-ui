/**
 * API-based org-admin fixture producer for the RELEASED appliance.
 *
 * THE-RELEASED-CONTRACT (2026-08-08). This replaces the pre-split producer
 * that shelled into the monolith container (`/app/identuum
 * --e2e-create-org-admin-fixture`, a `/e2e-auth` bind mount, `make
 * local-restart`). Every one of those assumptions is gone: this talks ONLY to
 * the released identuum-idp-oss HTTP API — the same surface a customer's
 * appliance exposes — and writes the SAME JSON envelope `fixture.ts` already
 * validates and every org-admin spec already consumes. Consumer contract
 * unchanged; only the producer moved from "monolith CLI" to "released API".
 *
 * The path, from a fresh appliance:
 *   1. setup: verify-token → complete (site_admin created with a known password)
 *   2. site_admin login → first-login TOTP enrolment → bearer
 *   3. create org (reserved e2e-<runID> name/slug/domain)
 *   4. create org_admin + org_user (POST /users, then PUT email_verified=true —
 *      newly-created accounts are unverified and login refuses them; setting
 *      email_verified is an admin capability, not a bypass — see identuum-idp
 *      tools/devseed)
 *   5. org_admin first-login TOTP enrolment CAPTURES the server-generated
 *      secret — the released API never accepts an injected secret, so the
 *      fixture's totp_secret is whatever the server minted, captured once.
 *   6. FIXTURE-DEPTH (Order B): the org_admin seeds the tenant-owned OAuth
 *      clients its [dynamic mode only] specs consume — a public client and a
 *      confidential client — over the same released API, discarding the
 *      one-time secret the confidential create returns. (API resources are NOT
 *      seeded: that admin surface is site_admin-gated on OSS.)
 *
 * SECURITY: passwords and the captured TOTP secret live only in the envelope
 * the loader reads (mode 0600, gitignored e2e/.auth/). This module never
 * console.logs a secret. Progress lines carry only non-secret status.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { generateTOTP } from "./totp";

export const E2E_FIXTURE_MARKER = "identuum-e2e-fixture-v1";
export const E2E_FIXTURE_SCHEMA_VERSION = 1;

// Public, transparent test passwords — never real, and only ever used against a
// throwaway appliance. Shaped like the credential-transparency placeholders.
const SITE_ADMIN_PASSWORD = "e2e-site-admin-not-a-secret-Aa1!";
const ORG_ADMIN_PASSWORD = "e2e-org-admin-not-a-secret-Aa1!";
const ORG_USER_PASSWORD = "e2e-org-user-not-a-secret-Aa1!";

export interface FixtureEnvelope {
  fixture_marker: string;
  schema_version: number;
  run_id: string;
  site_admin: { email: string; password: string; totp_secret: string };
  organization: { name: string; slug: string; domain: string; id: string };
  org_admin: { email: string; password: string; totp_secret: string; user_id: string };
  org_user: { email: string; password: string; totp_secret: string; user_id: string };
  // FIXTURE-DEPTH (Order B) — tenant-owned OAuth clients the org_admin
  // [dynamic mode only] specs consume. Never carry secret material: the public
  // sample client has no secret, and the confidential client discards the
  // one-time secret the create API returns.
  sample_client: { id: string; client_id: string; name: string; is_public: boolean };
  confidential_sample_client: { id: string; client_id: string; name: string; is_public: boolean };
  // THE-INVERTED-GUARD (2026-08-30): the api-resources surface now answers
  // to the org's own org_admin, so the producer seeds one AS the org_admin
  // (the one-time resource_secret is discarded — never carried).
  api_resource: {
    id: string;
    audience: string;
    name: string;
    active: boolean;
    token_ttl_secs: number;
  };
}

interface Json {
  [k: string]: unknown;
}

/**
 * THE-SESSION-REJECTIONS (2026-08-30): every api() call is recorded in a
 * bounded ring (timestamp, method, path, status, server Date header, rtt) so
 * that a mid-run session rejection is diagnosable from the failure output —
 * the IdP answers an identical `{"error":"unauthorized"}` for a bad token, an
 * expired session, a revoked jti, AND a fail-closed store error, and logs
 * nothing server-side, so the client-side timeline is the only record.
 * Values are never recorded — only names, statuses, and timings.
 */
const API_RING_MAX = 300;
const apiRing: Array<{
  t: number;
  method: string;
  path: string;
  status: number;
  date: string | null;
  rtt: number;
}> = [];

/** Formatted tail of the api() call ring, newest last. */
export function apiCallLog(last = 40): string {
  return apiRing
    .slice(-last)
    .map(
      (e) =>
        `${new Date(e.t).toISOString()} ${e.method} ${e.path} -> ${e.status} rtt=${e.rtt}ms server-date=${e.date ?? "-"}`
    )
    .join("\n");
}

/**
 * THE-CLOSURE-AUDIT (2026-08-31): evidence tap for specs that drive requests
 * OUTSIDE api() — playwright `request` fixtures, browser-context fetches. A
 * spec calls observeRaw AFTER its own assertion passed, recording only
 * method/path/status (role "session": these are cookie/ceremony surfaces).
 * closure-from-run.mjs reads the same JSONL, so "covered elsewhere" claims
 * become observed-in-run facts. Never values, never tokens; logging failures
 * never break a test.
 */
export function observeRaw(method: string, path: string, status: number): void {
  const matrixLog = process.env.IDENTUUM_E2E_MATRIX_LOG;
  if (!matrixLog) return;
  try {
    appendFileSync(
      matrixLog,
      `${JSON.stringify({ m: method, p: path, role: "session", s: status })}\n`
    );
  } catch {
    // never fail a test on observation logging
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  body?: Json,
  bearer?: string
): Promise<{ status: number; json: Json; date: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const date = res.headers.get("date");
  apiRing.push({
    t: t0,
    method,
    path,
    status: res.status,
    date,
    rtt: Date.now() - t0,
  });
  if (apiRing.length > API_RING_MAX) apiRing.splice(0, apiRing.length - API_RING_MAX);
  // THE-ROLE-CENSUS (2026-08-30): when the harness sets
  // IDENTUUM_E2E_MATRIX_LOG, every api() call appends one JSONL observation —
  // method, path, the ROLE decoded from the bearer's own claims (anon when
  // unauthenticated), and the status. role-matrix-from-run.mjs collapses
  // these against the docgen endpoint golden into the (endpoint, role)
  // coverage matrix. Token VALUES are never written; a logging failure never
  // breaks a test.
  const matrixLog = process.env.IDENTUUM_E2E_MATRIX_LOG;
  if (matrixLog) {
    let role = "anon";
    if (bearer) {
      role = "unknown";
      try {
        const payload = JSON.parse(
          Buffer.from(
            bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
          ).toString()
        ) as Json;
        if (typeof payload.role === "string" && payload.role.length > 0) role = payload.role;
      } catch {
        // opaque or malformed token — recorded as "unknown"
      }
    }
    try {
      appendFileSync(matrixLog, `${JSON.stringify({ m: method, p: path, role, s: res.status })}\n`);
    } catch {
      // never fail a test on observation logging
    }
  }
  let json: Json = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { _raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, json, date };
}

function must(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[e2e fixture] ${msg}`);
}

const SITE_ADMIN_EMAIL = "site_admin@system.local";

/**
 * A site_admin bearer + captured TOTP secret via setup (if needed) +
 * first-login TOTP enrolment. On an already-set-up appliance the enrolment is
 * skipped by the server (login goes straight to mfa_required); in that case the
 * secret is unavailable and this returns an empty secret — but global-setup
 * only ever runs this against a FRESH appliance it just brought up, so the
 * enrolment path is the live one.
 */
async function ensureSetupAndSiteAdmin(base: string, setupCode: string): Promise<LoginResult> {
  const status = await api(base, "GET", "/api/setup/status");
  const state = (status.json.state as string) ?? "";
  if (state === "setup_required") {
    must(setupCode.length > 0, "appliance is setup_required but no setup code was provided");
    const v = await api(base, "POST", "/api/setup/verify-token", { setup_token: setupCode });
    must(v.status === 204, `setup verify-token → ${v.status}, want 204`);
    const c = await api(base, "POST", "/api/setup/complete", {
      setup_token: setupCode,
      organization_name: "E2E System Bootstrap",
      organization_domain: "e2e-bootstrap.test",
      admin_email: "owner@e2e-bootstrap.test",
      admin_password: SITE_ADMIN_PASSWORD,
    });
    must(c.status === 200, `setup complete → ${c.status}, want 200`);
  }
  return firstLoginBearerAsync(base, SITE_ADMIN_EMAIL, SITE_ADMIN_PASSWORD);
}

interface LoginResult {
  bearer: string;
  totpSecret: string;
}

/**
 * Logs a fresh account in through its FIRST-login TOTP enrolment, returning the
 * bearer AND the server-generated TOTP secret. Retries enrol/complete once
 * across a 30s TOTP boundary if the first code straddled the window.
 */
async function firstLoginBearerAsync(
  base: string,
  email: string,
  password: string
): Promise<LoginResult> {
  const login = await api(base, "POST", "/api/v1/auth/login", { email, password });
  must(
    login.status === 401 && Boolean(login.json.session_id),
    `${email}: first login want 401+session_id, got ${login.status}`
  );
  const sessionId = login.json.session_id as string;
  const init = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/initiate", {
    session_id: sessionId,
  });
  must(
    init.status === 200 && Boolean(init.json.secret),
    `${email}: enroll/initiate → ${init.status}`
  );
  const secret = init.json.secret as string;
  let complete = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
    session_id: sessionId,
    code: generateTOTP(secret, 0),
  });
  if (complete.status !== 200) {
    // One retry on the next window in case we straddled a 30s boundary.
    await new Promise((r) => setTimeout(r, 1000));
    complete = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
      session_id: sessionId,
      code: generateTOTP(secret, 1),
    });
  }
  must(complete.status === 200, `${email}: enroll/complete → ${complete.status}`);
  const bearer = (complete.json.access_token as string) ?? (complete.json.token as string) ?? "";
  must(bearer.length > 0, `${email}: enrolment returned no bearer`);
  return { bearer, totpSecret: secret };
}

/**
 * Logs an ALREADY-ENROLLED account in with a KNOWN TOTP secret
 * (password → mfa_required → verify). Used by the reuse probe: it proves a
 * saved envelope's credentials still authenticate against the running
 * appliance WITHOUT re-enrolling. Returns true on a 200 with a bearer.
 *
 * SECURITY: takes the secret only as an argument, returns a boolean; never
 * logs the secret or the password.
 */
export async function totpLoginWorks(
  base: string,
  email: string,
  password: string,
  totpSecret: string
): Promise<boolean> {
  try {
    const login = await api(base, "POST", "/api/v1/auth/login", { email, password });
    if (login.status !== 401 || !login.json.session_id) return false;
    const sessionId = login.json.session_id as string;
    // Already-enrolled accounts return mfa_required → verify at /login/mfa.
    for (const win of [0, 1]) {
      const verify = await api(base, "POST", "/api/v1/auth/login/mfa", {
        session_id: sessionId,
        code: generateTOTP(totpSecret, win),
      });
      if (verify.status === 200 && (verify.json.access_token || verify.json.token)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function createOrg(
  base: string,
  bearer: string,
  runId: string
): Promise<{ id: string; name: string; slug: string; domain: string }> {
  const name = `e2e-fixture-${runId}-org`;
  const slug = `e2e-fixture-${runId}`;
  const domain = `e2e-${runId}.test`;
  // active:true is REQUIRED. Without it the org is created inactive, and the
  // org-liveness boundary (P0-3) refuses login for every user in a
  // non-operational org — surfacing as an opaque invalid_credentials that
  // looks like a wrong password but is a dead tenant.
  //
  // mfa_policy:"required" so EVERY user type is TOTP-enrolled, not just the
  // admins. TOTP enrolment is demanded of admins by default; a required org
  // policy extends that to org_users, so all three fixture identities have a
  // captured TOTP secret and the suite covers TOTP login for each.
  const res = await api(
    base,
    "POST",
    "/api/v1/organizations",
    { name, domain, slug, active: true, mfa_policy: "required" },
    bearer
  );
  must(res.status === 201, `create org → ${res.status}`);
  const id = (res.json.id as string) ?? (res.json.ID as string) ?? "";
  must(id.length > 0, "create org returned no id");
  return { id, name, slug, domain };
}

async function createVerifiedUser(
  base: string,
  bearer: string,
  email: string,
  password: string,
  role: string,
  orgId: string
): Promise<string> {
  const create = await api(
    base,
    "POST",
    "/api/v1/users",
    { email, password, role, organization_id: orgId },
    bearer
  );
  must(create.status >= 200 && create.status < 300, `create ${role} → ${create.status}`);
  const id = (create.json.id as string) ?? (create.json.ID as string) ?? "";
  must(id.length > 0, `create ${role} returned no id`);
  // Newly-created accounts are unverified; login refuses them. email_verified
  // is an admin-settable field (identuum-idp tools/devseed documents this as
  // the supported capability, not a bypass).
  const verify = await api(base, "PUT", `/api/v1/users/${id}`, { email_verified: true }, bearer);
  must(verify.status >= 200 && verify.status < 300, `verify ${role} → ${verify.status}`);
  return id;
}

interface SeededClient {
  id: string;
  client_id: string;
  name: string;
  is_public: boolean;
}

/**
 * Seeds one OAuth client in the fixture org via the org_admin bearer — the
 * tenant-owned surface an org_admin manages for its OWN org (the handler pins
 * organization_id to the actor's org). The released API GENERATES the
 * client_id server-side (crypto random, 32 hex); a caller cannot inject the
 * readable literal the retired monolith CLI used, so the envelope carries the
 * server's real client_id and the loader anchors run-scoping on the reserved
 * NAME. The seeded redirect URI + scope are the operator-safe loopback values
 * the applications specs assert verbatim. For a confidential client the create
 * API returns a one-time client_secret; it is DISCARDED here — the envelope
 * never stores client secrets.
 */
async function createClient(
  base: string,
  bearer: string,
  name: string,
  isPublic: boolean
): Promise<SeededClient> {
  const res = await api(
    base,
    "POST",
    "/api/v1/clients",
    {
      name,
      redirect_uris: ["http://localhost:7104/callback"],
      scope: "openid profile email",
      is_public: isPublic,
    },
    bearer
  );
  must(res.status === 201, `create client "${name}" → ${res.status}, want 201`);
  const client = (res.json.client as Json) ?? {};
  const id = (client.id as string) ?? "";
  const clientId = (client.client_id as string) ?? "";
  must(id.length > 0 && clientId.length > 0, `create client "${name}" returned no id/client_id`);
  // is_public is not echoed by the safe client shape; it is exactly what we
  // requested, so record the requested value.
  return { id, client_id: clientId, name, is_public: isPublic };
}

// NOTE (Order B / Order C): NO API-resource seed. On the released OSS v0.3.0
// appliance the ENTIRE /api/v1/api-resources admin surface is gated by
// mw.RequireSiteAdmin() (create AND read), so an org_admin gets 403 — the
// org-admin API-resources UI surface (built against a wider org_admin contract)
// is unreachable on OSS. Seeding cannot fix a backend authz gate, so the
// org-admin-api-resources [dynamic mode only] specs stay justified SKIPs
// (loader returns null → explicit skip) rather than being forced. Service
// accounts likewise need no seed: both service-account dynamic specs create +
// delete their OWN SA (fixture-org CASCADE cleanup).

/**
 * The already-acquired site_admin a caller injects into
 * seedFixtureFromSiteAdmin: an authenticated bearer plus the three credential
 * fields that flow verbatim into the envelope's site_admin block. Lets a caller
 * that ALREADY has a site_admin (e.g. the e2e-full harness's bootstrapped +
 * MFA-enrolled site_admin, whose captured secret siteAdminSession retains) seed
 * the fixture WITHOUT re-running the setup wizard — the disposable harness
 * reuses its ONE bootstrap rather than adding a second.
 */
export interface AcquiredSiteAdmin {
  bearer: string;
  email: string;
  password: string;
  totpSecret: string;
}

/**
 * Builds the full fixture envelope against the released appliance at `base`.
 * `setupCode` is consulted only if the appliance is still setup_required.
 */
export async function buildFixtureEnvelope(
  base: string,
  runId: string,
  setupCode: string
): Promise<FixtureEnvelope> {
  const siteAdmin = await ensureSetupAndSiteAdmin(base, setupCode);
  return seedFixtureFromSiteAdmin(base, runId, {
    bearer: siteAdmin.bearer,
    email: SITE_ADMIN_EMAIL,
    password: SITE_ADMIN_PASSWORD,
    totpSecret: siteAdmin.totpSecret,
  });
}

/**
 * Seeds the org / org_admin / org_user / OAuth-client half of the fixture
 * against an ALREADY-ACQUIRED site_admin, and assembles the envelope. Split out
 * of buildFixtureEnvelope (byte-identical seeding steps) so a caller holding a
 * pre-existing site_admin — the e2e-full harness reusing its bootstrap — can
 * produce the SAME envelope every dev-loop spec consumes, without a second
 * setup path. The site_admin credentials passed here flow verbatim into the
 * envelope's site_admin block.
 */
export async function seedFixtureFromSiteAdmin(
  base: string,
  runId: string,
  acquiredSiteAdmin: AcquiredSiteAdmin
): Promise<FixtureEnvelope> {
  const siteAdminBearer = acquiredSiteAdmin.bearer;

  const org = await createOrg(base, siteAdminBearer, runId);
  const orgAdminEmail = `admin@e2e-${runId}.test`;
  const orgUserEmail = `user@e2e-${runId}.test`;

  // site_admin delegates the FIRST org_admin of an admin-less org — the one
  // tenant-write the model permits it. A regular org_user, by contrast, is the
  // tenant's own business: site_admin creating one is refused (403), so the
  // org_user is created by the org_admin below.
  const orgAdminId = await createVerifiedUser(
    base,
    siteAdminBearer,
    orgAdminEmail,
    ORG_ADMIN_PASSWORD,
    "org_admin",
    org.id
  );

  // Capture the org_admin's server-generated TOTP secret via first-login
  // enrolment. This is the only way to know the secret — the API never accepts
  // an injected one — and it yields the org_admin bearer used to seed the
  // org_user within the tenant's own authority.
  const orgAdmin = await firstLoginBearerAsync(base, orgAdminEmail, ORG_ADMIN_PASSWORD);
  const orgUserId = await createVerifiedUser(
    base,
    orgAdmin.bearer,
    orgUserEmail,
    ORG_USER_PASSWORD,
    "org_user",
    org.id
  );

  // Capture the org_user's TOTP secret via first-login enrolment too. The org's
  // required MFA policy makes enrolment demanded for org_users as well, so all
  // three fixture identities carry a captured secret and the suite covers TOTP
  // login for site_admin, org_admin, AND org_user.
  const orgUser = await firstLoginBearerAsync(base, orgUserEmail, ORG_USER_PASSWORD);

  // FIXTURE-DEPTH (THE-ALL-GREEN-SUITE Order B): seed the tenant-owned OAuth
  // clients the org_admin [dynamic mode only] specs consume — a PUBLIC client
  // and a CONFIDENTIAL client — both created with the org_admin's OWN authority
  // over its OWN org (POST /api/v1/clients pins organization_id to the actor).
  const sampleClient = await createClient(
    base,
    orgAdmin.bearer,
    `E2E Sample Application ${runId}`,
    true
  );
  const confidentialClient = await createClient(
    base,
    orgAdmin.bearer,
    `E2E Confidential Application ${runId}`,
    false
  );

  // THE-INVERTED-GUARD: seed the API resource the [dynamic] api-resources
  // specs consume, AS the org_admin (the surface answers to the tenant's
  // own admin now). The exact naming matches the loader's pins
  // (loadOrgAdminFixtureApiResource). The one-time resource_secret in the
  // response is deliberately never read.
  const apiResourceCreate = await api(
    base,
    "POST",
    "/api/v1/api-resources",
    {
      name: `E2E Sample API ${runId}`,
      audience: `https://api.e2e-${runId}.test`,
      active: true,
      token_ttl_secs: 3600,
      // Both scopes, with the exact descriptions the [dynamic] specs pin.
      scopes: [
        { name: "read", description: "Read fixture API resource" },
        { name: "write", description: "Write fixture API resource" },
      ],
    },
    orgAdmin.bearer
  );
  must(
    apiResourceCreate.status >= 200 && apiResourceCreate.status < 300,
    `create api resource → ${apiResourceCreate.status}`
  );
  const apiResourceBlock = apiResourceCreate.json.api_resource as {
    id?: string;
  } | null;
  const apiResourceID = apiResourceBlock?.id ?? "";
  must(apiResourceID.length > 0, "create api resource returned no id");

  return {
    fixture_marker: E2E_FIXTURE_MARKER,
    schema_version: E2E_FIXTURE_SCHEMA_VERSION,
    run_id: runId,
    site_admin: {
      email: acquiredSiteAdmin.email,
      password: acquiredSiteAdmin.password,
      totp_secret: acquiredSiteAdmin.totpSecret,
    },
    organization: { name: org.name, slug: org.slug, domain: org.domain, id: org.id },
    org_admin: {
      email: orgAdminEmail,
      password: ORG_ADMIN_PASSWORD,
      totp_secret: orgAdmin.totpSecret,
      user_id: orgAdminId,
    },
    org_user: {
      email: orgUserEmail,
      password: ORG_USER_PASSWORD,
      totp_secret: orgUser.totpSecret,
      user_id: orgUserId,
    },
    sample_client: sampleClient,
    confidential_sample_client: confidentialClient,
    api_resource: {
      id: apiResourceID,
      audience: `https://api.e2e-${runId}.test`,
      name: `E2E Sample API ${runId}`,
      active: true,
      token_ttl_secs: 3600,
    },
  };
}

/**
 * THE-DISPOSABLE-IDENTITIES (2026-08-30): seeds the DISPOSABLE recovery org —
 * identities the destructive ceremonies may mutate without touching anything
 * the rest of the suite logs in with. Fixed identifiers (fresh appliance every
 * run, so no collision):
 *
 *   - org "E2E Disposable Recovery" (slug e2e-recovery, domain
 *     e2e-recovery.test), mfa_policy OPTIONAL — so the rotate-user below can
 *     complete a plain no-MFA login, which the change-password ceremony
 *     drives.
 *   - a disposable org_admin (TOTP-enrolled via first login — the MFA-reset
 *     ceremony's target; resetting it stales NOTHING shared).
 *   - a disposable org_user "rotate" target with a password and NO MFA
 *     enrollment (never logged in here), for the password-rotate ceremony.
 *
 * Passwords come from the harness run's environment (generated run-local in
 * full-run.sh, never printed). Returns only non-secret identifiers.
 */
export async function seedDisposableRecoveryFixture(
  base: string,
  siteAdminBearer: string,
  adminPassword: string,
  rotatePassword: string
): Promise<{ orgId: string; orgAdminEmail: string; rotateEmail: string }> {
  const create = await api(
    base,
    "POST",
    "/api/v1/organizations",
    {
      name: "E2E Disposable Recovery",
      slug: "e2e-recovery",
      domain: "e2e-recovery.test",
      active: true,
      mfa_policy: "optional",
    },
    siteAdminBearer
  );
  must(create.status >= 200 && create.status < 300, `create recovery org → ${create.status}`);
  const orgId = (create.json.id as string) ?? "";
  must(orgId.length > 0, "recovery org returned no id");

  const orgAdminEmail = "admin@e2e-recovery.test";
  const rotateEmail = "rotate@e2e-recovery.test";

  await createVerifiedUser(base, siteAdminBearer, orgAdminEmail, adminPassword, "org_admin", orgId);
  // Enroll the disposable admin's TOTP via first login (captures nothing we
  // keep — the MFA-reset ceremony only needs the enrollment to EXIST).
  const admin = await firstLoginBearerAsync(base, orgAdminEmail, adminPassword);

  // The rotate-user is created by the disposable admin (tenant authority) and
  // NEVER logged in here — mfa_enabled stays false by construction.
  await createVerifiedUser(base, admin.bearer, rotateEmail, rotatePassword, "org_user", orgId);

  return { orgId, orgAdminEmail, rotateEmail };
}

/**
 * Resolves the available Compose invocation as an argv prefix: prefers Docker
 * Compose v2 (`docker compose`), falls back to the legacy v1 binary
 * (`docker-compose`). Returns null when neither is callable. `composeFile` is
 * appended as `-f <file>` so callers pass only the subcommand.
 */
export function composeCommand(composeFile: string): string[] | null {
  for (const probe of [
    ["docker", ["compose", "version"]],
    ["docker-compose", ["version"]],
  ] as const) {
    try {
      execFileSync(probe[0], probe[1], { stdio: "ignore" });
      return probe[0] === "docker"
        ? ["docker", "compose", "-f", composeFile]
        : ["docker-compose", "-f", composeFile];
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Reads the appliance's current setup code from inside the container. */
export function readSetupCode(compose: string[], service: string): string {
  try {
    const [prog, ...pre] = compose;
    const out = execFileSync(
      prog,
      [...pre, "exec", "-T", service, "/app/identuum-idp", "show-setup-code", "/app/data"],
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString("utf-8");
    const m = out.match(/[A-Z0-9]{40,}/);
    return m ? m[0] : "";
  } catch {
    return "";
  }
}

// `api` is additionally exported for the e2e-full disposable suite
// (THE-DISPOSABLE-HARNESS): the two suites SHARE this HTTP helper rather
// than fork it — forking is how suites drift apart. Additive export only;
// no dev-loop behavior changes.
export { api, firstLoginBearerAsync };

/**
 * THE-UNUSABLE-TOKEN (2026-08-31): assert the activation envelope contract on
 * every endpoint that issues an activation credential.
 *
 * A returned token must arrive with the link that CONSUMES it, or with an
 * honest reason naming the setting to configure — never bare (the /activate
 * page reads ?token from the query string and has no input field, so a bare
 * token cannot be redeemed by hand) and never a guessed URL.
 *
 * Exactly one of activation_url / activation_url_unavailable is present. When
 * the link exists it must point at /activate and carry the SAME token; when it
 * does not, the reason must name IDENTUUM_IDP_UI_PUBLIC_BASE_URL and must not
 * assert a deployment topology (the "air-gapped" misnomer this slice removed —
 * air-gapped is a CE feature; OSS runs with email configured or not).
 *
 * Never logs the token or the link.
 */
export function assertActivationEnvelope(
  body: Json,
  expectedToken: string | undefined,
  where: string
): void {
  const url = typeof body.activation_url === "string" ? body.activation_url : "";
  const reason =
    typeof body.activation_url_unavailable === "string" ? body.activation_url_unavailable : "";
  must(
    (url === "") !== (reason === ""),
    `${where}: exactly one of activation_url / activation_url_unavailable must be present`
  );
  if (url !== "") {
    const parsed = new URL(url);
    must(
      parsed.pathname === "/activate",
      `${where}: activation_url path is ${parsed.pathname}, want /activate`
    );
    const carried = parsed.searchParams.get("token") ?? "";
    must(carried.length > 0, `${where}: activation_url carries no token`);
    if (expectedToken !== undefined) {
      must(
        carried === expectedToken,
        `${where}: activation_url token does not match activation_token`
      );
    }
    return;
  }
  must(
    reason.includes("IDENTUUM_IDP_UI_PUBLIC_BASE_URL"),
    `${where}: the refusal must name the setting to configure`
  );
  must(
    !/air[\s-]?gap/i.test(reason),
    `${where}: the refusal must not assert a deployment topology (air-gapped is a CE feature)`
  );
}
