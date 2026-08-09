#!/usr/bin/env node
/**
 * ui-runtime-preset.mjs — compose config/ui-runtime.json from a named
 * preset (THE-OPERATOR-PATH order D).
 *
 * Why this exists: switching a backend on or off used to mean hand-editing
 * gitignored JSON, and the UI's own error copy says "Run identuum-ui-setup"
 * — a container one-shot (setup/setup.mjs) with no npm entry point in this
 * repo. This script IS that entry point for local development.
 *
 * Every URL is DERIVED from a port — ui_origin and internal_base_url are
 * never hand-typed. That kills the recurring trap where a stale config
 * pinned ui_origin to :7114 and internal_base_url to host.docker.internal
 * while the dev server ran on :7104 as a host process (hit twice; see
 * e2e/DRIFT-2026-08-07.md's env-residue findings). host.docker.internal is
 * only correct when the UI itself runs inside a container; for the
 * host-run `next dev` this script serves, localhost is derived instead.
 *
 * Usage:
 *   node scripts/ui-runtime-preset.mjs <preset> [--ui-port N] [--idp-port N]
 *        [--ag-port N] [--ag-identity-port N] [--out PATH] [--print]
 *
 * Presets:
 *   idp-only   IdP enabled, AG absent           (defaults: ui 7104, idp 7113)
 *   hybrid     IdP + AG enabled                 (adds: ag 7215, ag-identity 7214)
 *   ag-only    AG enabled, IdP absent           (defaults: ui 7104, ag 7215/7214)
 *
 * npm entry points: `pnpm config:idp-only`, `pnpm config:hybrid`,
 * `pnpm config:ag-only` (see package.json).
 *
 * SECURITY: the runtime config carries no secrets — only ports/URLs and
 * enable flags. The output file is gitignored (config/ui-runtime.json).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PRESETS = ["idp-only", "hybrid", "ag-only"];

function fail(msg) {
  process.stderr.write(`ui-runtime-preset: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const preset = args[0];
if (!preset || !PRESETS.includes(preset)) {
  fail(
    `usage: ui-runtime-preset.mjs <${PRESETS.join("|")}> [--ui-port N] [--idp-port N] [--ag-port N] [--ag-identity-port N] [--out PATH] [--print]`
  );
}

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`--${name} needs a value`);
  return v;
}

function port(name, fallback) {
  const v = flag(name, String(fallback));
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail(`--${name} must be a port, got ${v}`);
  return n;
}

const uiPort = port("ui-port", 7104);
const idpPort = port("idp-port", 7113);
const agPort = port("ag-port", 7215);
const agIdentityPort = port("ag-identity-port", 7214);
const printOnly = args.includes("--print");
const outPath = flag("out", path.join("config", "ui-runtime.json"));

// DERIVED, never hand-typed. localhost on both public and internal:
// this config is for the host-run `next dev`; a containerized UI is
// configured by setup/setup.mjs (env-driven) instead.
const local = (p) => `http://localhost:${p}`;

const idpEnabled = preset !== "ag-only";
const agEnabled = preset !== "idp-only";

const config = {
  configured: true,
  ui_origin: local(uiPort),
  idp: {
    enabled: idpEnabled,
    public_base_url: idpEnabled ? local(idpPort) : "",
    ...(idpEnabled ? { internal_base_url: local(idpPort) } : {}),
  },
  ag: {
    enabled: agEnabled,
    public_base_url: agEnabled ? local(agPort) : "",
    ...(agEnabled
      ? {
          internal_base_url: local(agPort),
          identity_base_url: local(agIdentityPort),
          identity_internal_base_url: local(agIdentityPort),
        }
      : {}),
  },
};

const json = `${JSON.stringify(config, null, 2)}\n`;
if (printOnly) {
  process.stdout.write(json);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, json, "utf-8");
process.stderr.write(
  `ui-runtime-preset: wrote ${outPath} (${preset}; ui :${uiPort}${idpEnabled ? `, idp :${idpPort}` : ""}${agEnabled ? `, ag :${agPort}/:${agIdentityPort}` : ""})\n`
);
