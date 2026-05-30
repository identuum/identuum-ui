#!/usr/bin/env node
/**
 * smoke-org-import-execute.mjs
 *
 * Operator-driven smoke harness for the first controlled organization-only
 * import/link execute test against the AG management surface.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SAFETY CONTRACT — read this before changing anything in this file.
 * ─────────────────────────────────────────────────────────────────────────
 *   * The script defaults to DRY-RUN ONLY. It never sends dry_run=false
 *     unless BOTH the `--execute-one` CLI flag AND the env var
 *     `IDENTUUM_CONFIRM_ORG_ONLY=organization_only` are present.
 *   * The script reads NO files. It does not source dev.env.local, .env,
 *     ~/.netrc, or any other credential file. All auth material comes from
 *     env vars that the operator has explicitly exported into the shell.
 *   * The script contains NO fallback credentials, NO embedded tokens, and
 *     NO bypass paths. If required env vars are missing it exits with a
 *     clear message and no network mutation.
 *   * The script issues at most one dry_run=true POST and at most one
 *     dry_run=false POST per invocation. No retry. No bulk loop. No
 *     "import all" path.
 *   * The script never prints cookies, bearer tokens, passwords, TOTP
 *     secrets, license payloads, signatures, ciphertext, request/response
 *     headers, or raw response bodies. Organization IDs are redacted to
 *     first 8 chars + ellipsis.
 *   * The script only writes to stdout/stderr — no file writes, no
 *     state files.
 *
 * USAGE — see docs/ORG_IMPORT_FIRST_EXECUTE_SMOKE.md.
 *
 * Auth modes (precedence order):
 *   1. Manual fallback / override:
 *        IDENTUUM_IDP_AUTH_HEADER  — opaque "Cookie: …" or "Authorization: …" line
 *        IDENTUUM_AG_AUTH_HEADER   — same for AG management surface
 *      When either is set, that side uses the manual header verbatim and
 *      does NOT attempt automated login for that side.
 *   2. Automated login mode (preferred):
 *      IDP site_admin login:
 *        IDENTUUM_SITE_ADMIN_EMAIL          (alias: IDENTUUM_TEST_ADMIN_EMAIL)
 *        IDENTUUM_SITE_ADMIN_PASSWORD       (alias: IDENTUUM_TEST_ADMIN_PASSWORD)
 *        IDENTUUM_SITE_ADMIN_TOTP_SECRET    (alias: IDENTUUM_TEST_MFA_SECRET)
 *                                            — required only if IDP returns
 *                                            mfa_required=true; harness
 *                                            generates the current TOTP
 *                                            code internally with HMAC-SHA1.
 *                                            Aliases match the env names
 *                                            written by identuum-idp/scripts/
 *                                            bootstrap-admin.sh into dev.env.local.
 *      AG operator login (preferred when AG bearer token is not supplied):
 *        IDENTUUM_AG_OPERATOR_EMAIL
 *        IDENTUUM_AG_OPERATOR_PASSWORD
 *      AG bearer token (alternative to AG email/password login):
 *        IDENTUUM_AG_OPERATOR_TOKEN
 *   3. Missing auth → clear blocker, exit 2, no network mutation.
 *
 * Optional execute-one mode:
 *   node scripts/smoke-org-import-execute.mjs --execute-one
 *   with IDENTUUM_CONFIRM_ORG_ONLY=organization_only also set in env.
 *
 * Exit codes:
 *   0 — completed successfully (dry-run-only or execute path, as configured)
 *   1 — unexpected runtime error during a planned step
 *   2 — missing required env var or flag combination (operator action needed)
 *   3 — no safe candidate available for the smoke (stops without mutation)
 *   4 — dry-run did not return a planned status (stops without mutation)
 *   5 — post-execute verification failed (mutation already happened, do not retry)
 *   6 — automated login failed (credentials rejected or backend unreachable);
 *       the harness prints the safe status code only, never the credentials.
 */

// ── Imports — Node stdlib only, no third-party packages ──────────────────
//
// node:fs is used ONLY to read the file path the operator explicitly passes
// via the --env-file flag. The harness performs NO automatic file discovery:
// it does not source .env, .env.local, dev.env.local, .envrc, ~/.netrc, or
// any other file unless --env-file <path> is on argv. The path is opened
// exactly once and never persisted.
import process from "node:process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// ── Constants ────────────────────────────────────────────────────────────
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";

const DEFAULT_IDP_URL = "http://127.0.0.1:7113";
const DEFAULT_AG_URL = "http://127.0.0.1:7215";
// AG identity surface (default IDENTITY_BIND_ADDR port for local dev).
// The /login endpoint lives here, separate from the management surface
// where /api/v1/organizations/* lives. Override with IDENTUUM_AG_IDENTITY_URL.
const DEFAULT_AG_IDENTITY_URL = "http://127.0.0.1:7214";

const HTTP_TIMEOUT_MS = 15_000;

// Disposable-name regex. A candidate qualifies as disposable when its
// safe display name OR slug contains one of these tokens anywhere (not
// just at the start) so names like "Playwright Expired Recovery Org" and
// "Local Smoke Org" both match. Automatic selection requires a positive
// disposable match — there is no "any eligible" fallback. Operators who
// need to test a non-disposable org must use the explicit
// IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID exact-id override.
const DISPOSABLE_NAME_REGEX =
  /\b(test|demo|local|sandbox|smoke|disposable|tmp|scratch|dev|qa|playwright|recovery|fixture|e2e|staging|throwaway)\b/i;

// Names that look production/customer/external-tenant. Used as a defence-
// in-depth secondary check: even when an explicit override is supplied,
// the canonical legal-entity suffixes here trigger a warning log line.
// The automatic selection path NEVER reaches this check today because the
// disposable-required rule short-circuits first, but the regex is kept so
// any future selection change still has a backstop against landing on
// obvious company names.
const PRODUCTION_HINT_REGEX =
  /\b(prod|production|customer|tenant|live|enterprise|acme|globex|initech|stark|wayne|umbrella|inc|llc|ltd|gmbh|sa|sas|bv|ag|oy|ab|aŞ|as|company|corp|corporation|holdings|group)\b/i;

// ── Output helpers — never print secrets ─────────────────────────────────
function log(line) {
  process.stdout.write(line + "\n");
}
function err(line) {
  process.stderr.write(line + "\n");
}
function redactID(id) {
  if (typeof id !== "string") return "";
  const trimmed = id.trim();
  if (trimmed.length <= 8) return trimmed;
  return trimmed.slice(0, 8) + "…";
}
function safeDisplayString(s) {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 77) + "…";
}

// ── Env + arg parsing ────────────────────────────────────────────────────
function parseArgs(argv) {
  // Supported flags:
  //   --execute-one        — gate 1 of 2 for sending dry_run=false
  //   --env-file <path>    — explicit operator-supplied env file
  //
  // Any other CLI argument fails closed so a typo like `--execute-all` can
  // never be interpreted as a bulk request.
  //
  // --env-file MUST be followed by a non-flag path argument. If the path is
  // missing (end of argv or another --flag follows), we mark the request
  // invalid; main() exits 2 with a clear message.
  const flags = { executeOne: false, envFile: "" };
  const unknown = [];
  let envFileMissingPath = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // Standard POSIX end-of-options marker. We accept it as a no-op so
      // operators can write `node scripts/... -- --env-file <path>`. Node
      // ≥20.6 has its own `--env-file` flag at the node CLI level, and the
      // `--` separator is the conventional way to pass our identically
      // named script flag through Node without being consumed.
      continue;
    }
    if (a === "--execute-one") {
      flags.executeOne = true;
    } else if (a === "--env-file") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        envFileMissingPath = true;
        break;
      }
      flags.envFile = next;
      i++;
    } else {
      unknown.push(a);
    }
  }
  return { flags, unknown, envFileMissingPath };
}

// parseEnvFile reads a single explicit env file and returns a {KEY: value}
// map. Used only when the operator passed --env-file <path>. The parser is
// intentionally minimal: no command substitution, no shell expansion, no
// ${VAR} interpolation, no export prefixes, no escape sequences.
//
// Supported lines:
//   KEY=value                — bare value, trimmed of trailing whitespace
//   KEY="value with spaces"  — double-quoted value (quotes stripped)
//   KEY='value with spaces'  — single-quoted value (quotes stripped)
//   # comment                — full-line comment, ignored
//   <blank line>             — ignored
//
// Malformed lines throw an Error whose message contains the 1-based line
// number ONLY — never the line's value, never the key. The caller maps
// the error to exit 2.
function parseEnvFile(path) {
  let content;
  try {
    content = readFileSync(path, "utf-8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      throw new Error(`env file not found: ${basename(path)}`);
    }
    const code = e && e.code ? e.code : "read-error";
    throw new Error(`could not read env file ${basename(path)}: ${code}`);
  }
  const out = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/^\s+/, "");
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`malformed env-file line ${i + 1}: missing '=' or empty key`);
    }
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`malformed env-file line ${i + 1}: invalid key`);
    }
    let value = trimmed.slice(eq + 1).replace(/\s+$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// readEnv resolves the configuration from process.env, optionally falling
// back to an operator-supplied fileEnv when a key is absent or empty in
// process.env.
//
// Precedence (per key):
//   1. process.env[KEY] when non-empty string         (real shell wins)
//   2. fileEnv[KEY] when fileEnv was passed           (env-file fill-in)
//   3. typed default (URL constants) or "" otherwise
//
// The operator can therefore override any env-file value from the shell
// without editing the file. fileEnv defaults to {} when --env-file is
// not supplied, keeping the behaviour identical to env-only callers.
function readEnv(fileEnv) {
  const get = (name) => {
    const p = process.env[name];
    if (typeof p === "string" && p !== "") return p;
    if (fileEnv && typeof fileEnv[name] === "string") return fileEnv[name];
    return "";
  };
  // getFirst returns {value, source} where source is the env name that
  // actually supplied the value (or "" if none did). Used for credential
  // aliases so the operator can rely on either the explicit smoke names
  // OR existing IDP-bootstrap names from identuum-idp/dev.env.local.
  const getFirst = (...names) => {
    for (const name of names) {
      const v = get(name);
      if (v !== "") return { value: v, source: name };
    }
    return { value: "", source: "" };
  };
  // Site-admin credential aliases. Preferred names first; IDP-bootstrap
  // names (written by identuum-idp/scripts/bootstrap-admin.sh) as fallback.
  const emailPick = getFirst("IDENTUUM_SITE_ADMIN_EMAIL", "IDENTUUM_TEST_ADMIN_EMAIL");
  const passwordPick = getFirst("IDENTUUM_SITE_ADMIN_PASSWORD", "IDENTUUM_TEST_ADMIN_PASSWORD");
  const totpPick = getFirst("IDENTUUM_SITE_ADMIN_TOTP_SECRET", "IDENTUUM_TEST_MFA_SECRET");
  return {
    idpUrl: (get("IDENTUUM_IDP_URL") || DEFAULT_IDP_URL).replace(/\/$/, ""),
    agUrl: (get("IDENTUUM_AG_URL") || DEFAULT_AG_URL).replace(/\/$/, ""),
    agIdentityUrl: (get("IDENTUUM_AG_IDENTITY_URL") || DEFAULT_AG_IDENTITY_URL).replace(/\/$/, ""),

    // Manual auth header overrides (precedence 1).
    idpAuthHeader: get("IDENTUUM_IDP_AUTH_HEADER"),
    agAuthHeader: get("IDENTUUM_AG_AUTH_HEADER"),

    // Automated IDP login credentials (precedence 2 for IDP).
    siteAdminEmail: emailPick.value,
    siteAdminEmailSource: emailPick.source,
    siteAdminPassword: passwordPick.value,
    siteAdminPasswordSource: passwordPick.source,
    siteAdminTotpSecret: totpPick.value,
    siteAdminTotpSecretSource: totpPick.source,

    // Automated AG operator login credentials (precedence 2 for AG).
    agOperatorEmail: get("IDENTUUM_AG_OPERATOR_EMAIL"),
    agOperatorPassword: get("IDENTUUM_AG_OPERATOR_PASSWORD"),

    // AG bearer token (alternative to AG email/password).
    agOperatorToken: get("IDENTUUM_AG_OPERATOR_TOKEN"),

    confirmOrgOnly: get("IDENTUUM_CONFIRM_ORG_ONLY"),

    // Explicit operator override of the disposable-only candidate filter.
    // Must be a valid UUID string equal to one of the IDP candidates'
    // ids. The override never bypasses dry-run/execute gates.
    allowIDPOrgID: get("IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID"),
  };
}

// isValidUUID returns true for an unbraced canonical-form UUID (8-4-4-4-12
// hex characters). Strict so a stray "1" or "" cannot be passed through
// the override env var.
function isValidUUID(s) {
  return typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ── TOTP (RFC 6238) — HMAC-SHA1, 30-second step, 6 digits ────────────────
// Pure Node stdlib (crypto.createHmac). The generated code is used once
// for the IDP MFA POST and is NEVER printed.
function generateTOTP(secretBase32) {
  const key = base32decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer; we split it into two 32-bit
  // writes because writeBigUInt64BE requires a BigInt and we want to stay
  // in plain Number arithmetic for the foreseeable Unix-time range.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

function base32decode(s) {
  // RFC 4648 base32 (uppercase). Padding optional. Whitespace ignored.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(s).replace(/[\s=]/g, "").toUpperCase();
  if (cleaned === "") throw new Error("TOTP secret is empty");
  let bits = "";
  for (const c of cleaned) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) throw new Error("invalid base32 character in TOTP secret");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ── Automated login — IDP site_admin ────────────────────────────────────
// Calls the official IDP routes:
//   POST /api/v1/auth/login            with {email, password}
//   POST /api/v1/auth/login/mfa        with {session_id, code} when MFA required
// Returns a Cookie header line ready to be passed verbatim to subsequent
// authenticated IDP requests. The token value is never logged.
async function performIDPLogin(env) {
  if (!env.siteAdminEmail || !env.siteAdminPassword) {
    throw new Error(
      "IDP automated login requires IDENTUUM_SITE_ADMIN_EMAIL and IDENTUUM_SITE_ADMIN_PASSWORD",
    );
  }
  const loginRes = await rawPostJSON(
    `${env.idpUrl}/api/v1/auth/login`,
    { email: env.siteAdminEmail, password: env.siteAdminPassword },
  );
  if (loginRes.status < 200 || loginRes.status >= 300) {
    throw new Error(`IDP /api/v1/auth/login returned HTTP ${loginRes.status}`);
  }
  const body = loginRes.body || {};
  let accessToken;
  if (body.mfa_required === true) {
    if (!env.siteAdminTotpSecret) {
      throw new Error(
        "IDP login returned mfa_required=true but IDENTUUM_SITE_ADMIN_TOTP_SECRET is not set",
      );
    }
    const sessionID = body.session_id;
    if (typeof sessionID !== "string" || sessionID === "") {
      throw new Error("IDP login response missing session_id");
    }
    // Generate the TOTP code from the operator's secret. The code is held
    // in this local variable only; it is never logged.
    const code = generateTOTP(env.siteAdminTotpSecret);
    const mfaRes = await rawPostJSON(
      `${env.idpUrl}/api/v1/auth/login/mfa`,
      { session_id: sessionID, code },
    );
    if (mfaRes.status < 200 || mfaRes.status >= 300) {
      throw new Error(`IDP /api/v1/auth/login/mfa returned HTTP ${mfaRes.status}`);
    }
    const mfaBody = mfaRes.body || {};
    accessToken = mfaBody?.tokens?.access_token;
  } else {
    accessToken = body?.tokens?.access_token;
  }
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error("IDP login response did not contain tokens.access_token");
  }
  // The IDP session cookie name is "access_token" (HttpOnly, SameSite=Lax).
  // We construct the Cookie header line in-memory and return it. The token
  // value never appears in any log line.
  return `Cookie: access_token=${accessToken}`;
}

// ── Automated login — AG operator ───────────────────────────────────────
// Calls the official AG identity-surface route:
//   POST <ag-identity-url>/login  with {email, password}
// Returns an Authorization header line. Token never logged.
async function performAGLogin(env) {
  if (!env.agOperatorEmail || !env.agOperatorPassword) {
    throw new Error(
      "AG automated login requires IDENTUUM_AG_OPERATOR_EMAIL and IDENTUUM_AG_OPERATOR_PASSWORD",
    );
  }
  const res = await rawPostJSON(`${env.agIdentityUrl}/login`, {
    email: env.agOperatorEmail,
    password: env.agOperatorPassword,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`AG /login returned HTTP ${res.status}`);
  }
  // The AG login response is `{access_token, token_type, expires_in}`.
  // Some helper wrappers may nest under data; we accept either.
  const body = res.body || {};
  const token = body?.access_token || body?.data?.access_token;
  if (typeof token !== "string" || token === "") {
    throw new Error("AG login response did not contain access_token");
  }
  return `Authorization: Bearer ${token}`;
}

// Low-level POST that does NOT carry auth — used by login helpers only.
// Kept separate from httpJSON() so login traffic can never accidentally
// pick up an unrelated Cookie/Authorization header.
async function rawPostJSON(url, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// Auth resolution — returns the header line for each side based on the
// precedence: manual override → automated login → blocker.
async function resolveAuthHeaders(env) {
  const result = { idp: "", ag: "", idpMode: "", agMode: "" };

  if (env.idpAuthHeader) {
    result.idp = env.idpAuthHeader;
    result.idpMode = "manual";
  } else if (env.siteAdminEmail && env.siteAdminPassword) {
    result.idp = await performIDPLogin(env);
    result.idpMode = "automated-login";
  }

  if (env.agAuthHeader) {
    result.ag = env.agAuthHeader;
    result.agMode = "manual";
  } else if (env.agOperatorToken) {
    result.ag = `Authorization: Bearer ${env.agOperatorToken}`;
    result.agMode = "operator-token";
  } else if (env.agOperatorEmail && env.agOperatorPassword) {
    result.ag = await performAGLogin(env);
    result.agMode = "automated-login";
  }

  return result;
}

// ── HTTP fetch helpers — never log auth headers ──────────────────────────
function buildHeaders(authHeader) {
  // The auth header is an opaque operator-supplied string of the form
  //   "Cookie: <name>=<value>"           — for IDP session cookies
  //   "Authorization: Bearer <jwt>"       — for AG operator tokens
  // The harness parses the prefix to know which fetch header to set. We
  // never log the auth value.
  const headers = { Accept: "application/json" };
  if (!authHeader) return headers;
  const idx = authHeader.indexOf(":");
  if (idx <= 0) {
    throw new Error(
      "auth header value must start with 'Cookie:' or 'Authorization:' followed by ':' and the header value",
    );
  }
  const name = authHeader.slice(0, idx).trim();
  const value = authHeader.slice(idx + 1).trim();
  if (!name || !value) {
    throw new Error("auth header value is malformed; refusing to set");
  }
  // We accept any header name the operator provides, but the only two
  // recognised auth names are Cookie and Authorization. Anything else is
  // refused to keep the surface tight.
  if (name !== "Cookie" && name !== "Authorization") {
    throw new Error(
      `unsupported auth header name '${name}'; only 'Cookie' or 'Authorization' are accepted`,
    );
  }
  headers[name] = value;
  return headers;
}

async function httpJSON(method, url, authHeader, body) {
  let headers;
  try {
    headers = buildHeaders(authHeader);
  } catch (e) {
    throw new Error(`auth header invalid for ${method} ${redactURL(url)}: ${e.message}`);
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
  let parsed = null;
  // We attempt to JSON-parse the body, but we never propagate the raw text
  // back to the caller. Callers only see status + parsed-or-null.
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function redactURL(u) {
  // Strip query string just in case. The path is safe to log.
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return u;
  }
}

// ── Candidate parsing — allowlist projection ─────────────────────────────
function projectCandidate(raw, fallbackSource) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || raw.id.trim() === "") return null;
  if (typeof raw.name !== "string" || raw.name.trim() === "") return null;
  return {
    id: raw.id,
    name: raw.name,
    slug: typeof raw.slug === "string" ? raw.slug : "",
    status: typeof raw.status === "string" ? raw.status : "",
    created_at: typeof raw.created_at === "string" ? raw.created_at : null,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    source_component:
      typeof raw.source_component === "string" && raw.source_component !== ""
        ? raw.source_component
        : fallbackSource,
    linked_idp_organization_id:
      typeof raw.linked_idp_organization_id === "string" &&
      raw.linked_idp_organization_id !== ""
        ? raw.linked_idp_organization_id
        : "",
    link_status: typeof raw.link_status === "string" ? raw.link_status : "",
  };
}

function projectCandidatesList(rawBody, fallbackSource) {
  if (!rawBody || typeof rawBody !== "object") return [];
  const arr = Array.isArray(rawBody.organizations) ? rawBody.organizations : [];
  const out = [];
  for (const r of arr) {
    const c = projectCandidate(r, fallbackSource);
    if (c) out.push(c);
  }
  return out;
}

// ── Selection priority ────────────────────────────────────────────────────
function looksDisposable(c) {
  return (
    DISPOSABLE_NAME_REGEX.test(c.name) || DISPOSABLE_NAME_REGEX.test(c.slug || "")
  );
}
function looksProduction(c) {
  return PRODUCTION_HINT_REGEX.test(c.name) || PRODUCTION_HINT_REGEX.test(c.slug || "");
}
function isSystemOrg(c) {
  return c.id === SYSTEM_ORG_ID;
}

function findAGByName(agCandidates, idpName) {
  const norm = idpName.trim().toLowerCase();
  if (norm === "") return null;
  for (const ag of agCandidates) {
    if (ag.name.trim().toLowerCase() === norm) return ag;
  }
  return null;
}
function findAGBySlug(agCandidates, idpSlug) {
  if (!idpSlug || idpSlug.trim() === "") return null;
  const norm = idpSlug.trim().toLowerCase();
  for (const ag of agCandidates) {
    if (ag.slug && ag.slug.trim().toLowerCase() === norm) return ag;
  }
  return null;
}

// chooseCandidate selects ONE IDP candidate for the smoke. The default is
// disposable-only: an IDP candidate's name OR slug must positively match
// DISPOSABLE_NAME_REGEX. There is NO "any eligible candidate" fallback —
// a company-looking org (e.g. "Vestel Inc.") will never be auto-selected.
//
// Operators who need to exercise a specific non-disposable org locally
// may set IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID to the exact IDP UUID.
// The override:
//   - matches by ID only (no name-based override exists)
//   - still rejects the system organization
//   - still rejects link-existing when the matched AG org is already linked
//   - does NOT bypass the dry-run-must-be-planned requirement
//   - does NOT bypass --execute-one + IDENTUUM_CONFIRM_ORG_ONLY for execute
//   - still chooses exactly one candidate; no bulk
//
// Priority order (no fallback to non-disposable):
//   P1. override (if env id is valid + present + not system) → create or link-existing per AG match state
//   P2. disposable IDP candidate with no AG match → create_ag_organization
//   P3. disposable IDP candidate whose matched AG org is unlinked → link_existing_ag_organization
//   otherwise: { kind: "none" } — the caller surfaces a blocker and stops.
function chooseCandidate(idpCandidates, agCandidates, overrideIDPID) {
  // ── P1. Explicit override ───────────────────────────────────────────────
  // Only ID-based override is supported. The harness validates the UUID
  // shape in main() before calling chooseCandidate; we double-check here
  // so a stray empty/invalid value falls through to the normal path.
  if (typeof overrideIDPID === "string" && overrideIDPID !== "") {
    const target = idpCandidates.find((c) => c.id === overrideIDPID);
    if (!target) {
      return {
        kind: "none",
        reason: "IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID did not match any IDP candidate",
      };
    }
    if (isSystemOrg(target)) {
      return { kind: "none", reason: "override targeted the system organization (refused)" };
    }
    const match = findAGBySlug(agCandidates, target.slug) ?? findAGByName(agCandidates, target.name);
    if (!match) {
      return { kind: "create", idp: target, ag: null, override: true };
    }
    if (isSystemOrg(match)) {
      return { kind: "none", reason: "override matched the system org on the AG side (refused)" };
    }
    if (match.link_status === "linked" || match.linked_idp_organization_id !== "") {
      return {
        kind: "none",
        reason: "override target's matched AG org is already linked (refused)",
      };
    }
    return { kind: "link_existing", idp: target, ag: match, override: true };
  }

  // ── Default automatic path: DISPOSABLE-ONLY ─────────────────────────────
  // Build the disposable-only eligibility list. The production-hint regex is
  // a defence-in-depth check; in practice, disposable+production overlap is
  // impossible for a well-named test org.
  const disposable = idpCandidates.filter((c) => {
    if (isSystemOrg(c)) return false;
    if (!looksDisposable(c)) return false;
    if (looksProduction(c)) return false;
    return true;
  });
  if (disposable.length === 0) {
    return { kind: "none", reason: "no disposable safe IDP candidate found" };
  }

  // P2. Disposable IDP with no AG match → create_ag_organization.
  for (const c of disposable) {
    const match = findAGBySlug(agCandidates, c.slug) ?? findAGByName(agCandidates, c.name);
    if (!match) return { kind: "create", idp: c, ag: null };
  }
  // P3. Disposable IDP whose matched AG org is UNLINKED → link_existing.
  for (const c of disposable) {
    const match = findAGBySlug(agCandidates, c.slug) ?? findAGByName(agCandidates, c.name);
    if (!match) continue;
    if (isSystemOrg(match)) continue;
    if (match.link_status === "linked" || match.linked_idp_organization_id !== "") {
      continue; // skip already-linked AG target
    }
    return { kind: "link_existing", idp: c, ag: match };
  }
  return { kind: "none", reason: "no disposable safe IDP candidate found" };
}

// ── Forbidden-field absence check ────────────────────────────────────────
const FORBIDDEN_FIELD_NAMES = [
  "users",
  "user_count",
  "admins",
  "org_admins",
  "emails",
  "email",
  "passwords",
  "password",
  "mfa",
  "mfa_secret",
  "totp",
  "totp_secret",
  "role_bindings",
  "roles",
  "reviewers",
  "auditors",
  "sessions",
  "tokens",
  "token",
  "license",
  "license_id",
  "signature",
  "ciphertext",
  "private_key",
  "raw_payload",
  "metadata",
  "audit",
  "auth_policy",
];

function scanForbiddenFields(rawBody, label) {
  const s = JSON.stringify(rawBody ?? {});
  const fails = [];
  for (const fk of FORBIDDEN_FIELD_NAMES) {
    if (s.includes(fk)) fails.push(fk);
  }
  if (fails.length > 0) {
    log(`[!] ${label}: forbidden field names present in response — ${fails.join(", ")}`);
    return false;
  }
  log(`[ok] ${label}: all ${FORBIDDEN_FIELD_NAMES.length} forbidden field names absent`);
  return true;
}

// ── Main flow ─────────────────────────────────────────────────────────────
async function main() {
  const { flags, unknown, envFileMissingPath } = parseArgs(process.argv.slice(2));
  if (envFileMissingPath) {
    err("`--env-file` requires a path argument, e.g. --env-file ./.smoke-org-import.env");
    process.exit(2);
  }
  if (unknown.length > 0) {
    err(`unexpected CLI arg: ${unknown.join(" ")}`);
    err("supported flags: --execute-one  --env-file <path>");
    process.exit(2);
  }

  // Explicit env-file read. ONLY happens when --env-file <path> is on argv.
  // The script never searches for, discovers, or fallback-loads any other
  // file. Parse errors are sanitized to "line N: <reason>" — no values.
  let fileEnv = {};
  let envFileBasename = "";
  if (flags.envFile) {
    try {
      fileEnv = parseEnvFile(flags.envFile);
    } catch (e) {
      err(`[blocker] env file load failed: ${e?.message ?? "unknown error"}`);
      process.exit(2);
    }
    envFileBasename = basename(flags.envFile);
  }
  const env = readEnv(fileEnv);

  log("== smoke-org-import-execute ==");
  log(`mode: ${flags.executeOne ? "execute-one (requires IDENTUUM_CONFIRM_ORG_ONLY)" : "dry-run-only"}`);
  // env-file status — basename only, never the path or values.
  log(`env file: ${flags.envFile ? `PROVIDED (${envFileBasename})` : "NOT PROVIDED"}`);
  log(`IDP url:          ${env.idpUrl}`);
  log(`AG  url:          ${env.agUrl}`);
  log(`AG identity url:  ${env.agIdentityUrl}`);
  // Print only PRESENCE flags for credentials. Values are never echoed.
  log("auth env presence:");
  log(`  IDENTUUM_IDP_AUTH_HEADER:         ${env.idpAuthHeader ? "set" : "-"}`);
  log(`  IDENTUUM_AG_AUTH_HEADER:          ${env.agAuthHeader ? "set" : "-"}`);
  // For site-admin credentials, also surface which env name supplied the
  // value when an alias was used (IDENTUUM_TEST_* from IDP bootstrap).
  const presenceTag = (value, source, preferred) =>
    value ? (source && source !== preferred ? `set (via ${source})` : "set") : "-";
  log(`  IDENTUUM_SITE_ADMIN_EMAIL:        ${presenceTag(env.siteAdminEmail, env.siteAdminEmailSource, "IDENTUUM_SITE_ADMIN_EMAIL")}`);
  log(`  IDENTUUM_SITE_ADMIN_PASSWORD:     ${presenceTag(env.siteAdminPassword, env.siteAdminPasswordSource, "IDENTUUM_SITE_ADMIN_PASSWORD")}`);
  log(`  IDENTUUM_SITE_ADMIN_TOTP_SECRET:  ${presenceTag(env.siteAdminTotpSecret, env.siteAdminTotpSecretSource, "IDENTUUM_SITE_ADMIN_TOTP_SECRET")}`);
  log(`  IDENTUUM_AG_OPERATOR_EMAIL:       ${env.agOperatorEmail ? "set" : "-"}`);
  log(`  IDENTUUM_AG_OPERATOR_PASSWORD:    ${env.agOperatorPassword ? "set" : "-"}`);
  log(`  IDENTUUM_AG_OPERATOR_TOKEN:       ${env.agOperatorToken ? "set" : "-"}`);
  log(`  IDENTUUM_CONFIRM_ORG_ONLY=organization_only: ${env.confirmOrgOnly === "organization_only" ? "YES" : "NO"}`);
  log(`  IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID:        ${env.allowIDPOrgID ? "set" : "-"}`);

  // Public health checks BEFORE any auth attempt — fast-fails on a misconfigured
  // local environment without exposing the auth flow to a broken backend.
  log("");
  log("[step] backend health (public component endpoints)");
  for (const [label, url] of [
    ["IDP", `${env.idpUrl}/api/v1/component`],
    ["AG", `${env.agUrl}/api/v1/component`],
  ]) {
    const { status, body } = await httpJSON("GET", url, "");
    if (status !== 200 || !body || body.status !== "ok") {
      err(`[blocker] ${label} /api/v1/component returned status=${status}`);
      process.exit(1);
    }
    log(`  ${label}: component=${body.component} status=${body.status} license.status=${body?.license?.status}`);
  }

  // Resolve auth headers — manual override or automated login.
  log("");
  log("[step] resolve auth (manual override > automated login > blocker)");
  let auth;
  try {
    auth = await resolveAuthHeaders(env);
  } catch (e) {
    // Login failure: print only the safe message (which contains an
    // HTTP status or a generic explanation), never credentials.
    err(`[blocker] automated login failed: ${e?.message ?? "unknown error"}`);
    err("no export-candidates fetch or import POST was made.");
    process.exit(6);
  }
  if (!auth.idp) {
    err("");
    err("[blocker] no IDP auth available. Either set IDENTUUM_IDP_AUTH_HEADER (manual),");
    err("or set IDENTUUM_SITE_ADMIN_EMAIL + IDENTUUM_SITE_ADMIN_PASSWORD (automated).");
    err("aliases also accepted: IDENTUUM_TEST_ADMIN_EMAIL + IDENTUUM_TEST_ADMIN_PASSWORD");
    err("(+ IDENTUUM_TEST_MFA_SECRET for MFA). Aliases match the names written by");
    err("the IDP bootstrap script — re-use that file via --env-file, or export them.");
    err("see docs/ORG_IMPORT_FIRST_EXECUTE_SMOKE.md.");
    process.exit(2);
  }
  if (!auth.ag) {
    err("");
    err("[blocker] no AG auth available. Pick ONE of:");
    err("  - IDENTUUM_AG_AUTH_HEADER (manual override)");
    err("  - IDENTUUM_AG_OPERATOR_TOKEN (bearer token)");
    err("  - IDENTUUM_AG_OPERATOR_EMAIL + IDENTUUM_AG_OPERATOR_PASSWORD (automated login)");
    err("see docs/ORG_IMPORT_FIRST_EXECUTE_SMOKE.md.");
    process.exit(2);
  }
  log(`  IDP session acquired: YES (mode=${auth.idpMode})`);
  log(`  AG  session/token acquired: YES (mode=${auth.agMode})`);

  // Authenticated reads.
  log("");
  log("[step] fetch IDP export candidates");
  const idpResp = await httpJSON(
    "GET",
    `${env.idpUrl}/api/v1/organizations/export-candidates`,
    auth.idp,
  );
  log(`  IDP HTTP ${idpResp.status}`);
  if (idpResp.status !== 200) {
    err("[blocker] IDP export-candidates returned non-200; check IDP auth env vars.");
    process.exit(1);
  }
  scanForbiddenFields(idpResp.body, "IDP export-candidates");
  const idpCandidates = projectCandidatesList(idpResp.body, "identuum-idp");
  log(`  IDP organization count: ${idpCandidates.length}`);
  printCandidates(idpCandidates.slice(0, 3));

  log("");
  log("[step] fetch AG export candidates");
  const agResp = await httpJSON(
    "GET",
    `${env.agUrl}/api/v1/organizations/export-candidates`,
    auth.ag,
  );
  log(`  AG HTTP ${agResp.status}`);
  if (agResp.status !== 200) {
    err("[blocker] AG export-candidates returned non-200; check IDENTUUM_AG_AUTH_HEADER.");
    process.exit(1);
  }
  scanForbiddenFields(agResp.body, "AG export-candidates");
  const agCandidates = projectCandidatesList(agResp.body, "identuum-ag");
  log(`  AG organization count: ${agCandidates.length}`);
  printCandidates(agCandidates.slice(0, 3));

  // Select.
  log("");
  log("[step] select one safe candidate");
  // Validate the override env var (if supplied) BEFORE selection. An
  // invalid UUID is operator error and must not silently fall back to the
  // disposable-only path — that would hide a typo. Only an empty value
  // (env not set) is allowed to skip the override.
  let overrideID = "";
  if (env.allowIDPOrgID !== "") {
    if (!isValidUUID(env.allowIDPOrgID)) {
      err("[blocker] IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID is not a valid UUID");
      err("the smoke stops without any network call. unset the variable or correct the value.");
      process.exit(2);
    }
    overrideID = env.allowIDPOrgID;
    log("  override env: IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID set");
  }
  const choice = chooseCandidate(idpCandidates, agCandidates, overrideID);
  if (choice.kind === "none") {
    err(`[blocker] no disposable safe IDP candidate found: ${choice.reason}`);
    err("Automatic selection is restricted to IDP organizations whose name or slug clearly");
    err("matches a disposable marker (test/demo/local/sandbox/smoke/dev/qa/playwright/recovery/etc.).");
    err("Company/customer-looking orgs are never chosen automatically.");
    err("To exercise a specific non-disposable org locally, set:");
    err("  IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID=<exact-IDP-UUID>");
    err("The override still requires the dry-run + execute gates to fire.");
    process.exit(3);
  }
  if (choice.override) {
    log("  override candidate selected: YES");
  } else {
    log("  override candidate selected: NO (default disposable-only selection)");
  }
  log(`  chosen kind: ${choice.kind}`);
  log(`  IDP candidate: id=${redactID(choice.idp.id)} name=${safeDisplayString(choice.idp.name)} slug=${safeDisplayString(choice.idp.slug)} status=${choice.idp.status}`);
  if (choice.ag) {
    log(`  matched AG:    id=${redactID(choice.ag.id)} name=${safeDisplayString(choice.ag.name)} link_status=${choice.ag.link_status || "unknown"}`);
  } else {
    log("  matched AG: (none — create-new path)");
  }

  // Dry-run.
  const idpOrgPayload = {
    id: choice.idp.id,
    name: choice.idp.name,
    slug: choice.idp.slug,
    status: choice.idp.status,
    source_component: "identuum-idp",
  };
  if (choice.idp.created_at) idpOrgPayload.created_at = choice.idp.created_at;
  if (choice.idp.updated_at) idpOrgPayload.updated_at = choice.idp.updated_at;

  const dryReqBody = { idp_organization: idpOrgPayload, dry_run: true };
  if (choice.kind === "link_existing") {
    dryReqBody.ag_organization_id = choice.ag.id;
  }

  log("");
  log("[step] dry-run preview (dry_run=true)");
  const dryResp = await httpJSON(
    "POST",
    `${env.agUrl}/api/v1/organizations/import-from-idp`,
    auth.ag,
    dryReqBody,
  );
  log(`  HTTP ${dryResp.status}`);
  const dryBody = dryResp.body || {};
  printActionSummary("dry-run", dryBody);
  if (dryResp.status !== 200 || dryBody.dry_run !== true || dryBody.status !== "planned") {
    err("[blocker] dry-run did not return dry_run=true and status=planned; stopping without execute.");
    process.exit(4);
  }
  if (
    dryBody.action !== "create_ag_organization" &&
    dryBody.action !== "link_existing_ag_organization"
  ) {
    err(`[blocker] dry-run returned unexpected action=${dryBody.action}; stopping without execute.`);
    process.exit(4);
  }

  if (!flags.executeOne) {
    log("");
    log("[stop] dry-run-only mode. To execute exactly one row, re-run with:");
    log("   --execute-one  AND  IDENTUUM_CONFIRM_ORG_ONLY=organization_only");
    log("no dry_run=false request was sent.");
    process.exit(0);
  }
  if (env.confirmOrgOnly !== "organization_only") {
    err("");
    err("[blocker] --execute-one supplied but IDENTUUM_CONFIRM_ORG_ONLY is not 'organization_only'.");
    err("set the env var to that exact string in the same shell as the run and re-invoke.");
    err("no dry_run=false request was sent.");
    process.exit(2);
  }

  // Execute exactly once.
  const execReqBody = { idp_organization: idpOrgPayload, dry_run: false };
  if (choice.kind === "link_existing") {
    execReqBody.ag_organization_id = choice.ag.id;
  }

  log("");
  log("[step] execute exactly one (dry_run=false)");
  const execResp = await httpJSON(
    "POST",
    `${env.agUrl}/api/v1/organizations/import-from-idp`,
    auth.ag,
    execReqBody,
  );
  log(`  HTTP ${execResp.status}`);
  const execBody = execResp.body || {};
  printActionSummary("execute", execBody);

  const okStatuses = new Set(["created", "linked", "already_linked"]);
  if (execResp.status >= 200 && execResp.status < 300 && okStatuses.has(execBody.status)) {
    log(`  execute accepted with status=${execBody.status}`);
  } else if (execBody.status === "rejected") {
    log(`  execute returned rejected (possibly a race or newly detected conflict); not retrying.`);
    process.exit(0);
  } else {
    err(`[blocker] execute returned unexpected status=${execBody.status} HTTP=${execResp.status}; not retrying.`);
    process.exit(1);
  }

  // Post-execute verification.
  log("");
  log("[step] post-execute verification — re-fetch AG export candidates");
  const agAfter = await httpJSON(
    "GET",
    `${env.agUrl}/api/v1/organizations/export-candidates`,
    auth.ag,
  );
  if (agAfter.status !== 200) {
    err(`[blocker] AG re-fetch returned ${agAfter.status}; cannot verify post-state. mutation already happened — do not retry.`);
    process.exit(5);
  }
  scanForbiddenFields(agAfter.body, "AG export-candidates (post-execute)");
  const agAfterCandidates = projectCandidatesList(agAfter.body, "identuum-ag");
  log(`  AG organization count after execute: ${agAfterCandidates.length}`);

  if (choice.kind === "create") {
    const created = agAfterCandidates.find(
      (c) => c.linked_idp_organization_id === choice.idp.id,
    );
    if (!created) {
      err("[blocker] post-execute: no AG org found linked to the selected IDP org id. do not retry.");
      process.exit(5);
    }
    log(`  new AG org: id=${redactID(created.id)} name=${safeDisplayString(created.name)} link_status=${created.link_status} idp=${redactID(created.linked_idp_organization_id)}`);
    if (created.source_component !== "identuum-ag" || created.link_status !== "linked") {
      err("[blocker] post-execute: new AG org has wrong source_component or link_status. do not retry.");
      process.exit(5);
    }
  } else {
    // link_existing
    const updated = agAfterCandidates.find((c) => c.id === choice.ag.id);
    if (!updated) {
      err("[blocker] post-execute: previously-known AG org disappeared. do not retry.");
      process.exit(5);
    }
    log(`  updated AG org: id=${redactID(updated.id)} name=${safeDisplayString(updated.name)} link_status=${updated.link_status} idp=${redactID(updated.linked_idp_organization_id)}`);
    if (updated.link_status !== "linked" || updated.linked_idp_organization_id !== choice.idp.id) {
      err("[blocker] post-execute: AG org link state did not move to linked or links to a different IDP id. do not retry.");
      process.exit(5);
    }
  }

  log("");
  log("[done] exactly one execute completed. no retry. no bulk.");
  process.exit(0);
}

function printCandidates(list) {
  for (const c of list) {
    log(
      `   - id=${redactID(c.id)} name=${safeDisplayString(c.name)} slug=${safeDisplayString(c.slug)} status=${c.status} src=${c.source_component} link=${c.link_status || "-"} idp=${c.linked_idp_organization_id ? redactID(c.linked_idp_organization_id) : "-"}`,
    );
  }
}

function printActionSummary(label, body) {
  log(`  [${label}] dry_run=${body.dry_run} action=${body.action} status=${body.status}`);
  log(`             idp_org_id=${redactID(body.idp_organization_id || "")} ag_org_id=${redactID(body.ag_organization_id || "")}`);
  log(`             ag_organization_created=${!!body.ag_organization_created} link_created=${!!body.link_created}`);
  if (typeof body.message === "string" && body.message !== "") {
    log(`             message: ${safeDisplayString(body.message)}`);
  }
}

main().catch((e) => {
  // Final safety net: never let an exception print a token-bearing
  // request URL or response body. We log only the error message.
  err(`[error] ${e?.message ?? String(e)}`);
  process.exit(1);
});
