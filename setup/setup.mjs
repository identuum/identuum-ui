#!/usr/bin/env node
/**
 * identuum-ui-setup — one-shot runtime configuration writer.
 *
 * Reads topology from environment variables, validates them, and writes
 * ui-runtime.json to the configured output path.
 *
 * Validation rules (U-010):
 *   - At least one of IdP or AG must be enabled.
 *   - If IdP is enabled, IDENTUUM_UI_IDP_PUBLIC_BASE_URL must be set.
 *   - If AG is enabled, IDENTUUM_UI_AG_PUBLIC_BASE_URL must be set.
 *
 * This helper configures deployment topology only (U-008). It does not
 * create users, modify IdP state, or handle credentials.
 */

import fs from "node:fs";
import path from "node:path";

function env(name, defaultVal) {
  return (process.env[name] ?? defaultVal ?? "").trim();
}

function bool(val) {
  return val.toLowerCase() === "true" || val === "1";
}

function fail(msg) {
  console.error(`[identuum-ui-setup] ERROR: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[identuum-ui-setup] ${msg}`);
}

// ── Read configuration ────────────────────────────────────────────────────────

const uiOrigin = env("IDENTUUM_UI_PUBLIC_ORIGIN", "");
const idpEnabled = bool(env("IDENTUUM_UI_IDP_ENABLED", "false"));
const idpPublicBaseUrl = env("IDENTUUM_UI_IDP_PUBLIC_BASE_URL", "");
const idpInternalBaseUrl = env("IDENTUUM_UI_IDP_INTERNAL_BASE_URL", "");
const agEnabled = bool(env("IDENTUUM_UI_AG_ENABLED", "false"));
const agPublicBaseUrl = env("IDENTUUM_UI_AG_PUBLIC_BASE_URL", "");
const agInternalBaseUrl = env("IDENTUUM_UI_AG_INTERNAL_BASE_URL", "");
const agIdentityBaseUrl = env("IDENTUUM_UI_AG_IDENTITY_BASE_URL", "");
const agIdentityInternalBaseUrl = env("IDENTUUM_UI_AG_IDENTITY_INTERNAL_BASE_URL", "");

const outputFile = env("IDENTUUM_UI_CONFIG_FILE", "/app/config/ui-runtime.json");

// ── Validate ──────────────────────────────────────────────────────────────────

if (!uiOrigin) {
  fail("IDENTUUM_UI_PUBLIC_ORIGIN is required.");
}

if (!idpEnabled && !agEnabled) {
  fail(
    "At least one backend must be enabled. " +
      "Set IDENTUUM_UI_IDP_ENABLED=true or IDENTUUM_UI_AG_ENABLED=true."
  );
}

if (idpEnabled && !idpPublicBaseUrl) {
  fail("IDENTUUM_UI_IDP_PUBLIC_BASE_URL is required when IDENTUUM_UI_IDP_ENABLED=true.");
}

if (agEnabled && !agPublicBaseUrl) {
  fail("IDENTUUM_UI_AG_PUBLIC_BASE_URL is required when IDENTUUM_UI_AG_ENABLED=true.");
}

// Warn if internal URL is set to a Docker service name pattern in an
// environment where that might not be appropriate. Just informational.
if (idpInternalBaseUrl?.startsWith("http://identuum-")) {
  info(
    "Note: IdP internal base URL looks like a Docker service name." +
      " This is correct for single-host Compose. For multi-host deployments," +
      " use a DNS name or omit the internal URL."
  );
}

// ── Build config ──────────────────────────────────────────────────────────────

const config = {
  configured: true,
  ui_origin: uiOrigin,
  idp: {
    enabled: idpEnabled,
    public_base_url: idpEnabled ? idpPublicBaseUrl : "",
    ...(idpEnabled && idpInternalBaseUrl ? { internal_base_url: idpInternalBaseUrl } : {}),
  },
  ag: {
    enabled: agEnabled,
    public_base_url: agEnabled ? agPublicBaseUrl : "",
    ...(agEnabled && agInternalBaseUrl ? { internal_base_url: agInternalBaseUrl } : {}),
    ...(agEnabled && agIdentityBaseUrl ? { identity_base_url: agIdentityBaseUrl } : {}),
    ...(agEnabled && agIdentityInternalBaseUrl
      ? { identity_internal_base_url: agIdentityInternalBaseUrl }
      : {}),
  },
};

// ── Write ─────────────────────────────────────────────────────────────────────

const dir = path.dirname(outputFile);
try {
  fs.mkdirSync(dir, { recursive: true });
} catch (err) {
  fail(`Could not create config directory ${dir}: ${err.message}`);
}

try {
  fs.writeFileSync(outputFile, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
} catch (err) {
  fail(`Could not write config file ${outputFile}: ${err.message}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

info("Runtime configuration written successfully.");
info("");
info(`  Config file : ${outputFile}`);
info(`  UI origin   : ${uiOrigin}`);
info(`  IdP enabled : ${idpEnabled}${idpEnabled ? ` (${idpPublicBaseUrl})` : ""}`);
info(`  AG enabled  : ${agEnabled}${agEnabled ? ` (${agPublicBaseUrl})` : ""}`);
info("");
info("identuum-ui will pick up the configuration automatically.");
info("Verify the UI is running: curl -fsS http://<ui-host>:<port>/api/runtime-config");
