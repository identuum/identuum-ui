/**
 * e2e-resource-isolation.test.ts — OSS-MINT-GUARD-2 (C1, C4, C5).
 *
 * Behaviour proofs, all OFFLINE, for the two Compose identities the e2e
 * harnesses own (judge ruling Q2(b)):
 *
 *   - scratch-e2e: e2e-full/scripts/full-run.sh (make e2e-full / e2e-quick).
 *     A COPY of the runner runs in a private temp layout whose PATH holds
 *     command stubs for docker, make, curl, lsof, pnpm and sleep, plus a stub
 *     gate driver. The stubs log argv and the Compose selectors they
 *     inherited; `docker compose config --format json` answers a synthetic
 *     resolved config. No real daemon, container, database or port is
 *     touched: the stub directory is FIRST on PATH and the PATH holds no
 *     directory with a real docker.
 *   - identuum-ui-e2e: the Playwright global setup/teardown's secondary
 *     released appliance (e2e/docker-compose.e2e.yml), driven through
 *     vi.mock of node:child_process (execFileSync only; spawnSync stays real
 *     for the runner proofs above).
 *
 * Every test records labels only (program, Compose subcommand, project,
 * selector names) — never a DSN, password, token or environment value.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO = resolve(__dirname, "..", "..");

// Each runner case spawns the whole runner against PATH stubs — dozens of
// stubbed docker calls, more since the whole-step teardown lists and checks
// everything before and after its removals (OSS-CANDIDATE-LIFECYCLE-FIX). Under
// the full suite's parallel load one case outran vitest's 5 s default; the
// spawn itself stays bounded at 60 s (runRunner), and so is each case.
vi.setConfig({ testTimeout: 60_000 });

// ── execFileSync interception (TS lifecycle proofs) ─────────────────────────
const cp = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; env?: Record<string, string | undefined> }[],
  handler: null as null | ((file: string, args: string[]) => string),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = vi.fn(
    (
      file: string,
      args: readonly string[],
      opts?: { env?: Record<string, string | undefined> }
    ) => {
      cp.calls.push({ file, args: [...args], env: opts?.env });
      if (!cp.handler) throw new Error("unexpected execFileSync in an offline test");
      return Buffer.from(cp.handler(file, [...args]));
    }
  );
  return { ...real, execFileSync };
});

// The run-end pacing file lives in /tmp; keep the tests off it.
const RUN_END_FILE = "/tmp/identuum-run-end.json";
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((p: unknown, ...rest: unknown[]) => {
    if (String(p) === RUN_END_FILE) throw new Error("ENOENT (offline test)");
    return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof real.readFileSync;
  const writeFileSync = ((p: unknown, ...rest: unknown[]) => {
    if (String(p) === RUN_END_FILE) return;
    return (real.writeFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof real.writeFileSync;
  const mod = { ...real, readFileSync, writeFileSync };
  return { ...mod, default: mod };
});

vi.mock("@playwright/test", () => ({ expect: () => ({}), test: {} }));

const reuse = vi.hoisted(() => ({ loginWorks: true, siteAdmin: true as boolean }));
vi.mock("../../e2e/helpers/appliance-fixture", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../e2e/helpers/appliance-fixture")>();
  return {
    ...real,
    totpLoginWorks: vi.fn(async () => reuse.loginWorks),
    readSetupCode: vi.fn(() => "SETUPCODEPLACEHOLDER"),
    buildFixtureEnvelope: vi.fn(async () => ({ fixture_marker: "synthetic" })),
  };
});
vi.mock("../../e2e/helpers/fixture", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../e2e/helpers/fixture")>();
  return {
    ...real,
    loadSiteAdminFixture: vi.fn(() =>
      reuse.siteAdmin
        ? { email: "site-admin@e2e.test", password: "not-a-secret", totpSecret: "NOTASECRET" }
        : null
    ),
  };
});

// ── full-run.sh in a private layout ─────────────────────────────────────────

interface Call {
  tool: string;
  cpn: string;
  cro: string;
  makeflags: string;
  makeoverrides: string;
  argv: string[];
}
interface RunResult {
  status: number | null;
  out: string;
  calls: Call[];
  /** The private layout root (also the default TMPDIR); the claim is lockOf(root). */
  root: string;
}

const LOCK = "identuum-harness.lock";
/** The runner's one claim line: a fixed path, never derived from TMPDIR (H1). */
const LOCK_LINE = "E2E_LOCK=/tmp/identuum-harness.lock";
/** Where the layout's copy keeps the claim (see layout()). */
const lockOf = (root: string) => join(root, "fixed", LOCK);

const SAFE_CONFIG = {
  name: "scratch-e2e",
  services: {
    "postgres-idp-oss": { container_name: "scratch-e2e-postgres" },
    app: { container_name: "scratch-e2e" },
    "mail-sink": {},
  },
  networks: { default: { name: "scratch-e2e_default" } },
  volumes: { "postgres-idp-oss-data-v18": { name: "scratch-e2e_postgres-idp-oss-data-v18" } },
};

const STUB_LOG_LINE = `log() { printf '%s\\t%s\\t%s\\t%s\\t%s\\t' "$1" "\${COMPOSE_PROJECT_NAME-<unset>}" "\${COMPOSE_REMOVE_ORPHANS-<unset>}" "\${MAKEFLAGS-<unset>}" "\${MAKEOVERRIDES-<unset>}" >>"$STUB_LOG"; shift; printf '%s\\037' "$@" >>"$STUB_LOG"; printf '\\n' >>"$STUB_LOG"; }`;

// A stateful daemon model (OSS-MINT-GUARD-4, review OSS-MINT-GUARD-3-PREREVIEW
// H2). $STUB_STATE holds one file per resource: c/<id> "name project
// invocation", n/<id> "name project invocation", v/<name> "createdAt project
// invocation" ("-" for an absent label). The nested startup (MAKE_STUB oss-up)
// creates the appliance's three containers, its network and its volume with
// the invocation label it reads from the overlay the runner passed; listings,
// inspections and removals answer from and act on that state. STUB_VOLUMES /
// STUB_NETWORKS / STUB_CONTAINERS are leftovers carrying this project's label;
// STUB_FOREIGN_* exist under the same names WITHOUT it, so only an UNFILTERED
// listing shows them; @IID@ in them stands for this invocation's id, read from
// the overlay the runner wrote (OSS-MINT-GUARD-5: the names it creates carry
// it). `context inspect` answers like the real CLI: DOCKER_HOST when set, else
// STUB_ENDPOINT (the current or DOCKER_CONTEXT context's endpoint). Every call
// also logs the DOCKER_HOST and DOCKER_CONTEXT it ran under to STUB_ENV_LOG.
// A removal of a volume that does not exist fails, as the real one does.
const DOCKER_STUB = `#!/bin/bash
${STUB_LOG_LINE}
log docker "$@"
printf '%s %s %s\\n' "$1" "\${DOCKER_HOST-<unset>}" "\${DOCKER_CONTEXT-<unset>}" >>"$STUB_ENV_LOG"
has() { local want="$1"; shift; for a in "$@"; do [ "$a" = "$want" ] && return 0; done; return 1; }
S="$STUB_STATE"; mkdir -p "$S/c" "$S/n" "$S/v"
# OSS-MINT-GUARD-6: a docker global selector reaching the stub is logged as
# unchecked-compose-selected and dropped; the daemon model answers its ID
# (S/engine-id, default guard6-engine-a), the mutex image's VOLUME config
# (null; STUB_NO_MUTEX_IMAGE: absent), and holds the daemon mutex as the
# directory S/mutex, created atomically (mkdir) as the daemon reserves a
# container name, with the owner and engine labels it was created with.
while [ "\${1:-}" = --host ] || [ "\${1:-}" = -H ] || [ "\${1:-}" = --context ] || [ "\${1:-}" = -c ]; do
  log unchecked-compose-selected "$1" "$2"; shift 2
done
[ "\${1:-}" != container ] || shift
if [ "\${1:-}" = info ] || [ "\${1:-} \${2:-}" = "system info" ]; then
  cat "$S/engine-id" 2>/dev/null || echo guard6-engine-a; exit 0
fi
if [ "$1 $2" = "image inspect" ]; then
  [ "\${STUB_NO_MUTEX_IMAGE:-}" = 1 ] && exit 1
  echo null; exit 0
fi
if [ "\${1:-}" = create ]; then
  nm=; owner=; engine=; prev=
  for a in "$@"; do
    [ "$prev" != --name ] || nm="$a"
    case "$a" in
    io.identuum.harness.mutex-owner=*) owner="\${a#*=}" ;;
    io.identuum.harness.engine=*) engine="\${a#*=}" ;;
    esac
    prev="$a"
  done
  [ "$nm" = identuum-harness-lock-engine ] || { echo 'unmodeled mutex name' >&2; exit 97; }
  mkdir "$S/mutex" 2>/dev/null || { echo 'Conflict: mutex name already in use' >&2; exit 1; }
  printf '%s\\n' "$owner" > "$S/mutex/owner"
  printf '%s\\n' "$engine" > "$S/mutex/engine"
  log mutex-created guard6-mutex-id; echo guard6-mutex-id; exit 0
fi
if [ "\${1:-}" = inspect ] && { has guard6-mutex-id "$@" || has identuum-harness-lock-engine "$@"; }; then
  [ -d "$S/mutex" ] || exit 1
  case "$*" in
  *mutex-owner*) echo "guard6-mutex-id $(cat "$S/mutex/owner") $(cat "$S/mutex/engine" 2>/dev/null)" ;;
  *) echo guard6-mutex-id ;;
  esac
  exit 0
fi
if [ "\${1:-}" = rm ] && has guard6-mutex-id "$@"; then
  rm -rf "$S/mutex"; log mutex-released guard6-mutex-id; exit 0
fi
if [ "\${1:-}" = ps ] && [ "\${STUB_PAUSE_PREFLIGHT:-}" = 1 ] && [ ! -e "$STUB_BARRIER/ready" ]; then
  : > "$STUB_BARRIER/ready"
  i=0
  while [ ! -e "$STUB_BARRIER/resume" ]; do
    i=$((i+1)); [ "$i" -lt 500 ] || exit 98
    /bin/sleep 0.01
done
fi
if [ "$1 $2" = "context inspect" ]; then
  [ -n "\${DOCKER_HOST:-}" ] && { echo "$DOCKER_HOST"; exit 0; }
  [ "\${STUB_CONTEXT_FAIL:-}" = 1 ] && exit 1
  echo "\${STUB_ENDPOINT:-unix:///var/run/docker.sock}"; exit 0
fi
iid=$(sed -n 's/.*"io.identuum.harness.invocation":"\\([0-9a-f]*\\)".*/\\1/p' "$STUB_OVERLAY" 2>/dev/null)
foreign() { local v="$1"; printf '%b' "\${v//@IID@/$iid}"; }
if [ "$1" = compose ]; then
  if has config "$@"; then cat "$STUB_CONFIG"; exit 0; fi
  if has down "$@"; then exit "\${STUB_DOWN_STATUS:-0}"; fi
  if has exec "$@" && [ "\${STUB_FAIL:-}" = bootstrap ]; then exit 5; fi
  exit 0
fi
q=; fmt=; filt=; prev=; last=
for a in "$@"; do
  case "$prev" in --filter) filt="$filt $a" ;; --format) fmt="$a" ;; esac
  case "$a" in -q | -aq) q=1 ;; esac
  prev="$a"; last="$a"
done
match() {
  local g
  for g in $filt; do
    case "$g" in
    label=com.docker.compose.project=*) [ "$2" = "\${g#*project=}" ] || return 1 ;;
    label=io.identuum.harness.invocation=*) [ "$3" = "\${g#*invocation=}" ] || return 1 ;;
    network=* | volume=*) [ "$2" = scratch-e2e ] || [ "\${4:-}" = attached ] || return 1 ;;
    *) return 1 ;;
    esac
  done
}
own=; case "$filt" in *project=scratch-e2e*) own=1 ;; esac
case "$1 $2" in
"network ls")
  for f in "$S"/n/*; do
    [ -e "$f" ] || continue; read -r nm pj iv <"$f"; match "$nm" "$pj" "$iv" || continue
    if [ -n "$q" ]; then echo "\${f##*/}"; else case "$fmt" in *.ID*) echo "\${f##*/} $nm" ;; *) echo "$nm" ;; esac; fi
  done
  [ -z "$q" ] && case "$fmt" in *.ID*) ;; *) { [ -n "$own" ] || [ -z "$filt" ]; } && printf '%b' "\${STUB_NETWORKS:-}"; [ -z "$filt" ] && foreign "\${STUB_FOREIGN_NETWORKS:-}" ;; esac
  exit 0 ;;
"volume ls")
  for f in "$S"/v/*; do
    [ -e "$f" ] || continue; read -r ct pj iv <"$f"; match "\${f##*/}" "$pj" "$iv" || continue; echo "\${f##*/}"
  done
  [ -z "$q" ] && { [ -n "$own" ] || [ -z "$filt" ]; } && printf '%b' "\${STUB_VOLUMES:-}"
  [ -z "$q" ] && [ -z "$filt" ] && foreign "\${STUB_FOREIGN_VOLUMES:-}"
  exit 0 ;;
"network inspect") [ -e "$S/n/$last" ] || exit 1; read -r nm pj iv <"$S/n/$last"; case "$fmt" in *index*) echo "$last $iv" ;; *) echo "$nm" ;; esac; exit 0 ;;
"volume inspect")
  [ -e "$S/v/$last" ] || exit 1; read -r ct pj iv <"$S/v/$last"
  case "$fmt" in *index*) echo "$ct $iv" ;; *) echo "$ct" ;; esac
  # REVIEW-R1 (E-RACE, OSS-MINT-GUARD-4-REVIEW): right after the FINAL identity
  # inspection has answered with the recorded identity, another writer of the
  # project removes the volume and creates its own, with the project's and the
  # invocation's labels, under the name the project's config resolves to. The
  # teardown inspects a volume twice (the whole-step check, then right before
  # its removal: OSS-CANDIDATE-LIFECYCLE-FIX); the second is the final one.
  k=$(cat "$S/vinspect" 2>/dev/null || echo 0)
  case "$fmt" in *index*) k=$((k + 1)); echo "$k" >"$S/vinspect" ;; esac
  case "$fmt|$k" in *index*\\|2)
    if [ "\${STUB_REPLACE_AFTER_INSPECT:-}" = 1 ]; then
      rm -f "$S/v/$last"; echo "2026-10-10T00:00:07Z $pj $iv" >"$S/v/scratch-e2e_postgres-idp-oss-data-v18"
      log replaced-after-inspect volume
    elif [ "\${STUB_REPLACE_AFTER_INSPECT:-}" = exact ]; then
      # The accepted residual (judge ruling Q3 (a)): the same, under this run's
      # exact, invocation-unique name.
      echo "2026-10-10T00:00:07Z $pj $iv" >"$S/v/$last"
      log replaced-after-inspect-exact volume
    fi ;;
  esac
  exit 0 ;;
"network rm") [ "\${STUB_RM_STATUS:-0}" = 0 ] || exit "$STUB_RM_STATUS"; rm -f "$S/n/$last"; exit 0 ;;
"volume rm")
  [ "\${STUB_RM_STATUS:-0}" = 0 ] || exit "$STUB_RM_STATUS"
  [ -e "$S/v/$last" ] || { echo "Error response from daemon: get $last: no such volume" >&2; exit 1; }
  rm -f "$S/v/$last"; exit 0 ;;
esac
case "$1" in
ps)
  for g in $filt; do case "$g" in publish=*) exit 0 ;; esac; done
  for f in "$S"/c/*; do
    [ -e "$f" ] || continue; read -r nm pj iv at <"$f"; match "$nm" "$pj" "$iv" "$at" || continue
    if [ -n "$q" ]; then echo "\${f##*/}"
    else case "$fmt" in *.ID*) echo "\${f##*/} $nm" ;; *) printf '%s\\t%s\\n' "$nm" "$pj" ;; esac; fi
  done
  [ -z "$q" ] && [ -z "$filt" ] && case "$fmt" in *.ID*) ;; *) printf '%b' "\${STUB_CONTAINERS:-}" ;; esac
  exit 0 ;;
inspect)
  case "$fmt" in *Config.Env*) echo "IDENTUUM_IDP_OSS_DB=synthetic-not-a-dsn"; exit 0 ;; esac
  [ -e "$S/c/$last" ] || exit 1; read -r nm pj iv <"$S/c/$last"
  case "$fmt" in
  *Mounts*) for v in "$S"/v/*; do [ -e "$v" ] && echo "\${v##*/}"; done ;;
  *compose.project*) echo "$last $iv $pj /$nm" ;;
  *) echo "$last $iv" ;;
  esac; exit 0 ;;
rm) case " $* " in *" -v "*) rm -f "$S/v/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; log implicit-anonymous-removal volume ;; esac; [ "\${STUB_RM_STATUS:-0}" = 0 ] || exit "$STUB_RM_STATUS"; [ "\${STUB_RM_NOOP:-}" = 1 ] || rm -f "$S/c/$last"; exit 0 ;;
esac
exit 0
`;

const MAKE_STUB = `#!/bin/bash
${STUB_LOG_LINE}
log make "$@"
S="$STUB_STATE"; mkdir -p "$S/c" "$S/n" "$S/v"
for a in "$@"; do
  case "$a" in COMPOSE_FILE=*) ovl="\${a##* -f }" ;; esac
done
for a in "$@"; do
  if [ "$a" = oss-up ]; then
    if [ "\${STUB_G6_NESTED:-}" = 1 ]; then
      "$STUB_REAL_MAKE" --no-print-directory -f "$STUB_NATIVE_COMPOSE" oss-up "\${@:3}" || exit "$?"
    fi
    inv=$(sed -n 's/.*"io.identuum.harness.invocation":"\\([0-9a-f]*\\)".*/\\1/p' "$ovl" 2>/dev/null)
    inv="\${inv:--}"
    log invocation "$inv"
    # The names the overlay gives the volume and the network, as Compose would
    # apply them; without one, the names the project's config resolves to.
    vname=$(node -e 'try { const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(((o.volumes || {})["postgres-idp-oss-data-v18"] || {}).name || ""); } catch {}' "$ovl")
    nname=$(node -e 'try { const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(((o.networks || {}).default || {}).name || ""); } catch {}' "$ovl")
    vname="\${vname:-scratch-e2e_postgres-idp-oss-data-v18}"; nname="\${nname:-scratch-e2e_default}"
    # A Compose that applied the overlay's labels but not its names.
    [ "\${STUB_IGNORE_OVERLAY_NAMES:-}" = 1 ] && { vname=scratch-e2e_postgres-idp-oss-data-v18; nname=scratch-e2e_default; }
    log created-names "$vname" "$nname"
    if [ "\${STUB_CHANGE_ENGINE:-}" = 1 ]; then
      echo guard6-engine-b > "$S/engine-id"
      log engine-changed guard6-engine-b
    fi
    for c in "c1 scratch-e2e-postgres" "c2 scratch-e2e" "c3 scratch-e2e-mail-sink-1"; do
      echo "\${c#* } scratch-e2e $inv" >"$S/c/\${c%% *}"
    done
    # A container this run did not create, outside the project, attached to
    # what it creates (SPEC K5).
    [ "\${STUB_FOREIGN_MEMBER:-}" = 1 ] && echo "scratch-intruder someone-else - attached" >"$S/c/fm"
    if [ "\${STUB_LATE_FOREIGN:-}" = network ]; then echo "$nname - -" >"$S/n/n1"
    else echo "$nname scratch-e2e $inv" >"$S/n/n1"; fi
    if [ "\${STUB_LATE_FOREIGN:-}" = volume ]; then echo "2026-10-10T00:00:09Z - -" >"$S/v/$vname"
    else echo "2026-10-10T00:00:01Z scratch-e2e $inv" >"$S/v/$vname"; fi
    if [ "\${STUB_FAIL:-}" = oss-up ]; then
      log partial-create oss-up
      exit 7
    fi
  fi
done
exit 0
`;

const GW_STUB = `#!/bin/bash
${STUB_LOG_LINE}
if [ "$1" = step ]; then
  name="\${3%%=*}"
  log gw step "$name"
  [ "$name" = "\${STUB_FAIL_STEP:-}" ] && exit 1
  if [ "$name" = provisioner ] && [ "\${STUB_NO_FIXTURE:-}" != 1 ]; then
    mkdir -p "$(dirname "$FIXTURE_FILE")"; printf '{}' >"$FIXTURE_FILE"
  fi
  # After the record, another invocation replaces the appliance's volume under
  # the same name and labels (a new creation time), or starts a container of
  # the same project.
  for v in "$STUB_STATE"/v/scratch-e2e_postgres-idp-oss-data-v18*; do :; done
  if [ "$name" = provisioner ] && [ "\${STUB_SAME_LABEL_REPLACEMENT:-}" = 1 ] && [ -e "$v" ]; then
    read -r ct pj iv <"$v"; echo "2026-10-10T00:00:05Z $pj $iv" >"$v"
    log replaced-by-other-invocation volume
  fi
  if [ "$name" = provisioner ] && [ "\${STUB_FOREIGN_CONTAINER:-}" = 1 ]; then
    echo "scratch-e2e-intruder-1 scratch-e2e someone-else" >"$STUB_STATE/c/f1"
    log foreign-container-started
  fi
  if [ "$name" = provisioner ]; then
    if [ -n "\${STUB_RECORD_DAMAGE:-}" ]; then
      read -r nm pj iv < "$STUB_STATE/c/c1"
      echo "foreign-preserve foreign-project $iv" > "$STUB_STATE/c/spoof"
    fi
    case "\${STUB_RECORD_DAMAGE:-}" in
    missing) rm -f "$(dirname "$STUB_OVERLAY")/created" ;;
    incomplete) printf 'incomplete\\n' >> "$(dirname "$STUB_OVERLAY")/created" ;;
    manifest) rm -f "$(dirname "$STUB_OVERLAY")/manifest.json" ;;
    esac
    if [ -n "\${STUB_ANONYMOUS:-}" ]; then
      echo "2030-01-01T00:00:00Z \${STUB_ANONYMOUS} -" > "$STUB_STATE/v/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    fi
  fi
  exit 0
fi
log gw "$1"
exit 0
`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function realBash(): string {
  const r = spawnSync("bash", ["-c", 'printf %s "$BASH"'], { encoding: "utf8" });
  return r.stdout;
}

function writeExec(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function layout(config: unknown): { root: string; ui: string; bin: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), "e2e-isolation-"));
  roots.push(root);
  const ui = join(root, "identuum-ui");
  const idp = join(root, "identuum-idp-oss");
  const bin = join(root, "bin");
  for (const d of [
    join(ui, "e2e-full", "scripts"),
    join(ui, "scripts"),
    join(idp, "deployment"),
    bin,
  ])
    mkdirSync(d, { recursive: true });
  // The runner's claim is ONE fixed path (H1). The copy points that one line at
  // this layout's own fixed directory, so a test never touches /tmp; TMPDIR is
  // left free to vary.
  const source = readFileSync(resolve(REPO, "e2e-full/scripts/full-run.sh"), "utf8");
  expect(source.split("\n").filter((l) => l === LOCK_LINE)).toHaveLength(1);
  mkdirSync(join(root, "fixed"));
  writeFileSync(
    join(ui, "e2e-full/scripts/full-run.sh"),
    source.replace(LOCK_LINE, `E2E_LOCK=${join(root, "fixed", LOCK)}`)
  );
  copyFileSync(
    resolve(REPO, "e2e-full/compose.mail-sink.yml"),
    join(ui, "e2e-full/compose.mail-sink.yml")
  );
  writeFileSync(join(idp, "deployment/docker-compose.dev.yml"), "services: {}\n");
  // Snapshot of the current OSS DEV_COMPOSE/oss-build/oss-up recipes. The
  // fixture avoids a sibling checkout dependency in the UI's native CI tests.
  copyFileSync(
    resolve(REPO, "src/__tests__/fixtures/guard6-oss-compose.mk"),
    join(root, "native-compose.mk")
  );
  // Same e2e-full recipe as UI Makefile; parent Make selector propagation is real.
  writeFileSync(
    join(root, "parent.mk"),
    "COMPOSE_CMD ?= docker compose\ne2e-full:\n\tbash identuum-ui/e2e-full/scripts/full-run.sh\n"
  );
  writeExec(join(ui, "scripts/gate-witness.sh"), GW_STUB);
  writeExec(join(bin, "docker"), DOCKER_STUB);
  writeExec(join(bin, "make"), MAKE_STUB);
  writeExec(join(bin, "curl"), '#!/bin/bash\nexit "${STUB_CURL_STATUS:-0}"\n');
  writeExec(join(bin, "lsof"), "#!/bin/bash\nexit 1\n");
  writeExec(join(bin, "pnpm"), "#!/bin/bash\nexit 0\n");
  writeExec(join(bin, "sleep"), "#!/bin/bash\nexit 0\n");
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(realBash(), join(bin, "bash"));
  writeFileSync(join(root, "config.json"), JSON.stringify(config));
  return { root, ui, bin, log: join(root, "calls.log") };
}

function runRunner(
  opts: {
    config?: unknown;
    env?: Record<string, string>;
    arrange?: (root: string) => void;
    parentMake?: "command" | "env-e";
    prepared?: ReturnType<typeof layout>;
  } = {}
): RunResult {
  const l = opts.prepared ?? layout(opts.config ?? SAFE_CONFIG);
  opts.arrange?.(l.root);
  const realMake = spawnSync("/bin/bash", ["-c", "command -v make"], {
    encoding: "utf8",
  }).stdout.trim();
  const program = opts.parentMake ? realMake : join(l.bin, "bash");
  const args = opts.parentMake
    ? [
        "--no-print-directory",
        "-f",
        join(l.root, "parent.mk"),
        ...(opts.parentMake === "env-e" ? ["-e"] : []),
        "e2e-full",
        ...(opts.parentMake === "command" ? [`COMPOSE_CMD=${opts.env?.COMPOSE_CMD}`] : []),
      ]
    : [join(l.ui, "e2e-full/scripts/full-run.sh")];
  const r = spawnSync(program, args, {
    cwd: l.root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      PATH: `${l.bin}:/usr/bin:/bin`,
      HOME: l.root,
      TMPDIR: l.root,
      STUB_LOG: l.log,
      STUB_ENV_LOG: join(l.root, "docker-env.log"),
      STUB_OVERLAY: join(lockOf(l.root), "invocation.json"),
      STUB_CONFIG: join(l.root, "config.json"),
      STUB_STATE: join(l.root, "state"),
      STUB_REAL_MAKE: realMake,
      STUB_NATIVE_COMPOSE: join(l.root, "native-compose.mk"),
      // Inherited selectors the runner must neutralise (C1).
      COMPOSE_PROJECT_NAME: "identuum-idp-oss",
      COMPOSE_REMOVE_ORPHANS: "true",
      MAKEFLAGS: "IDENTUUM_IDP_COMPOSE_PROJECT=identuum-idp-oss",
      MAKEOVERRIDES: "IDENTUUM_IDP_COMPOSE_PROJECT=identuum-idp-oss",
      ...opts.env,
    },
  });
  const calls: Call[] = existsSync(l.log)
    ? readFileSync(l.log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [tool, cpn, cro, makeflags, makeoverrides, rest] = line.split("\t");
          return {
            tool,
            cpn,
            cro,
            makeflags,
            makeoverrides,
            argv: (rest ?? "").split("\x1f").filter((a) => a !== ""),
          };
        })
    : [];
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, calls, root: l.root };
}

/** The invocation id the run's startup carried (from its overlay), or "". */
const invocationOf = (r: RunResult) => r.calls.find((c) => c.tool === "invocation")?.argv[0] ?? "";

/** Each docker call's subcommand with the DOCKER_HOST and DOCKER_CONTEXT it ran under. */
function dockerEnv(r: RunResult): { sub: string; host: string; context: string }[] {
  const file = join(r.root, "docker-env.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sub, host, context] = line.split(" ");
      return { sub, host, context };
    });
}

/** The daemon model's resources left after the run, as kind/id paths. */
function remaining(r: RunResult): string[] {
  const out: string[] = [];
  for (const kind of ["c", "n", "v"]) {
    const dir = join(r.root, "state", kind);
    if (existsSync(dir)) for (const f of readdirSync(dir)) out.push(`${kind}/${f}`);
  }
  return out.sort();
}

const RESOURCE_ACTIONS = new Set([
  "up",
  "down",
  "exec",
  "build",
  "create",
  "start",
  "run",
  "rm",
  "stop",
  "restart",
  "kill",
  "pull",
]);

/** The Compose subcommand of a `docker compose ...` argv (after global flags). */
function composeSub(argv: string[]): string {
  for (let i = 1; i < argv.length; i++) {
    if (["-p", "-f", "--profile", "--project-name", "--file", "--env-file"].includes(argv[i])) {
      i++;
      continue;
    }
    if (argv[i].startsWith("-")) continue;
    return argv[i];
  }
  return "";
}

const composeCalls = (r: RunResult) =>
  r.calls.filter((c) => c.tool === "docker" && c.argv[0] === "compose");
const resourceActions = (r: RunResult) =>
  composeCalls(r).filter((c) => RESOURCE_ACTIONS.has(composeSub(c.argv)));
const downs = (r: RunResult) => composeCalls(r).filter((c) => composeSub(c.argv) === "down");
const makeCalls = (r: RunResult) => r.calls.filter((c) => c.tool === "make");
const indexOf = (r: RunResult, pred: (c: Call) => boolean) => r.calls.findIndex(pred);

function expectPinnedOwnership(r: RunResult): void {
  const compose = composeCalls(r);
  expect(compose.length, "the runner issued Compose commands").toBeGreaterThan(0);
  for (const c of compose) {
    expect(
      c.argv.slice(1, 3),
      `every compose command names its project first: ${composeSub(c.argv)}`
    ).toEqual(["-p", "scratch-e2e"]);
    expect(c.cpn, "no inherited COMPOSE_PROJECT_NAME reaches compose").toBe("<unset>");
    expect(c.cro, "no inherited COMPOSE_REMOVE_ORPHANS reaches compose").toBe("<unset>");
  }
  const startup = makeCalls(r).filter((c) => c.argv.includes("oss-up"));
  expect(startup.length, "one nested oss-up").toBe(1);
  for (const m of makeCalls(r)) {
    expect(m.argv, "nested make names the harness project").toContain(
      "IDENTUUM_IDP_COMPOSE_PROJECT=scratch-e2e"
    );
    expect(m.argv).toContain("DEV_PG_HOST_PORT=15513");
    expect(m.argv).toContain("DEV_APP_PORT=17113");
    expect(
      [m.cpn, m.cro, m.makeflags, m.makeoverrides],
      "nested make inherits no selector"
    ).toEqual(["<unset>", "<unset>", "<unset>", "<unset>"]);
  }
  // Validation precedes every resource action and the nested startup.
  const cfg = indexOf(r, (c) => c.tool === "docker" && composeSub(c.argv) === "config");
  const firstAction = indexOf(
    r,
    (c) =>
      (c.tool === "docker" &&
        c.argv[0] === "compose" &&
        RESOURCE_ACTIONS.has(composeSub(c.argv))) ||
      c.tool === "make"
  );
  expect(cfg, "the resolved config is validated").toBeGreaterThanOrEqual(0);
  expect(cfg, "validation precedes the first resource action").toBeLessThan(firstAction);
  const leftover = indexOf(r, (c) => c.tool === "docker" && c.argv[0] === "volume");
  expect(leftover, "leftovers are checked before validation").toBeGreaterThanOrEqual(0);
  expect(leftover).toBeLessThan(cfg);
}

/** Every docker call that removes a container, network or volume. */
const removals = (r: RunResult) =>
  r.calls.filter(
    (c) =>
      c.tool === "docker" &&
      (c.argv[0] === "rm" || (["network", "volume"].includes(c.argv[0]) && c.argv[1] === "rm"))
  );
/** The volume this invocation creates: the config's name plus its own id (R1). */
const volumeOf = (r: RunResult) => `scratch-e2e_postgres-idp-oss-data-v18_${invocationOf(r)}`;
/**
 * What the run created in the daemon model: three containers, a network and a
 * volume, the volume removed only under its invocation-unique name (R1).
 */
const createdRemovals = (r: RunResult) => [
  "network rm n1",
  "rm -f c1",
  "rm -f c2",
  "rm -f c3",
  `volume rm ${volumeOf(r)}`,
];

/** Everything the run created in the daemon model, as kind/id paths. */
const createdPaths = (r: RunResult) => ["c/c1", "c/c2", "c/c3", "n/n1", `v/${volumeOf(r)}`];

/**
 * A refused or failed teardown keeps the harness claim, the daemon mutex and
 * the record, whose public manifest.json says refused (SPEC K2, K5).
 */
function expectRetained(r: RunResult): void {
  expect(existsSync(lockOf(r.root)), "the claim is kept").toBe(true);
  expect(existsSync(join(r.root, "state/mutex")), "the daemon mutex is kept").toBe(true);
  const manifest = JSON.parse(readFileSync(join(lockOf(r.root), "manifest.json"), "utf8"));
  expect(manifest.state, "the kept record says refused").toBe("refused");
  expect(r.out).toMatch(/claim .* is KEPT with this run's record/);
}

/**
 * The teardown removes exactly what the run recorded creating, each by ID, after
 * the startup it cleans, with no project-level `down` (H2), and leaves nothing.
 */
function expectRecordedRemovalAfterCreate(r: RunResult): void {
  expect(downs(r), "no project-level down, with or without --volumes").toEqual([]);
  const create = indexOf(r, (c) => c.tool === "make" && c.argv.includes("oss-up"));
  expect(create, "the run attempted its startup").toBeGreaterThanOrEqual(0);
  const removed = removals(r);
  expect(removed.map((c) => c.argv.join(" ")).sort(), "each recorded resource once, by ID").toEqual(
    createdRemovals(r)
  );
  for (const c of removed) {
    expect(r.calls.indexOf(c), "the teardown follows the startup it cleans").toBeGreaterThan(
      create
    );
  }
  expect(remaining(r), "nothing the run created is left").toEqual([]);
}

describe("full-run.sh owns exactly one Compose project [C1/C5]", () => {
  it("pins every compose action to scratch-e2e, starts nested make under the same project with no inherited selector, labels what it starts with its invocation id, and removes exactly what it recorded creating [E2E-RESOURCE-OWNERSHIP-1]", () => {
    const r = runRunner();
    expect(r.status, r.out).toBe(0);
    expectPinnedOwnership(r);
    expectRecordedRemovalAfterCreate(r);
    const startup = makeCalls(r).find((c) => c.argv.includes("oss-up"));
    expect(
      startup?.argv.find((a) => a.startsWith("COMPOSE_FILE=")),
      "the start carries the invocation overlay"
    ).toMatch(/ -f \S+\/invocation\.json$/);
    expect(r.out).toMatch(/recorded 5 resource\(s\) this run created, by ID/);
    const lastCompose = r.calls
      .map((c) => c.tool === "docker" && c.argv[0] === "compose")
      .lastIndexOf(true);
    expect(
      r.calls.indexOf(removals(r)[0]),
      "the removals follow the last Compose action"
    ).toBeGreaterThan(lastCompose);
    // Bind the missing-record refusal to the ownership rule's extracted span.
    const damaged = runRunner({ env: { STUB_RECORD_DAMAGE: "missing" } });
    expect(damaged.status, damaged.out).not.toBe(0);
    expect(removals(damaged), "labels cannot replace creation evidence").toEqual([]);
    expectRetained(damaged);
  });

  it("quick mode keeps the same ownership contract", () => {
    const r = runRunner({ env: { E2E_MODE: "quick" } });
    expect(r.status, r.out).toBe(0);
    expectPinnedOwnership(r);
    expectRecordedRemovalAfterCreate(r);
  });
});

describe("full-run.sh refuses a resolved config it does not own [C1]", () => {
  const variants: Record<string, unknown> = {
    "protected project name": { ...SAFE_CONFIG, name: "identuum-idp-oss" },
    "protected default network": {
      ...SAFE_CONFIG,
      networks: { default: { name: "identuum-idp-oss_default" } },
    },
    "external volume": {
      ...SAFE_CONFIG,
      volumes: { "postgres-idp-oss-data-v18": { name: "scratch-e2e_x", external: true } },
    },
    "volume outside the project": {
      ...SAFE_CONFIG,
      volumes: { "postgres-idp-oss-data-v18": { name: "identuum-idp-oss-postgres-data" } },
    },
    "protected container name": {
      ...SAFE_CONFIG,
      services: { ...SAFE_CONFIG.services, app: { container_name: "identuum-idp-oss" } },
    },
    "unexpected container name": {
      ...SAFE_CONFIG,
      services: { ...SAFE_CONFIG.services, app: { container_name: "someone-else" } },
    },
    // OSS-CANDIDATE-LIFECYCLE-FIX (SPEC K1): services, mounts, modes, ports,
    // image names and aliases of the resolved config.
    "a service outside the harness": {
      ...SAFE_CONFIG,
      services: { ...SAFE_CONFIG.services, extra: {} },
    },
    "a host bind mount": {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        app: {
          container_name: "scratch-e2e",
          volumes: [{ type: "bind", source: "/tmp", target: "/x" }],
        },
      },
    },
    "a privileged service": {
      ...SAFE_CONFIG,
      services: { ...SAFE_CONFIG.services, "mail-sink": { privileged: true } },
    },
    "the host network": {
      ...SAFE_CONFIG,
      services: { ...SAFE_CONFIG.services, "mail-sink": { network_mode: "host" } },
    },
    "a port on every interface": {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        app: {
          container_name: "scratch-e2e",
          ports: [{ host_ip: "0.0.0.0", published: "17113", target: 17113 }],
        },
      },
    },
    "a port this run did not reserve": {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        "mail-sink": { ports: [{ host_ip: "127.0.0.1", published: "8025", target: 8025 }] },
      },
    },
    "a built image not named for the project": {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        app: {
          container_name: "scratch-e2e",
          build: { context: "." },
          image: "identuum-idp-oss-dev:local",
        },
      },
    },
    "a protected network alias": {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        "mail-sink": { networks: { default: { aliases: ["identuum-idp-oss"] } } },
      },
    },
    "a volume backed by a host path": {
      ...SAFE_CONFIG,
      volumes: {
        "postgres-idp-oss-data-v18": {
          name: "scratch-e2e_postgres-idp-oss-data-v18",
          driver_opts: { type: "none", o: "bind", device: "/tmp" },
        },
      },
    },
  };
  for (const key of [
    "volumes_from",
    "external_links",
    "links",
    "network_mode",
    "pid",
    "ipc",
    "uts",
    "use_api_socket",
    "devices",
    "configs",
    "secrets",
    "provider",
  ]) {
    variants[`R-ADV B2 ${key} outside this run`] = {
      ...SAFE_CONFIG,
      services: {
        ...SAFE_CONFIG.services,
        "mail-sink": { [key]: ["container:identuum-idp-oss-postgres:ro"] },
      },
    };
  }
  for (const [label, config] of Object.entries(variants)) {
    it(`${label}: refuses before any up/down/exec or nested make`, () => {
      const r = runRunner({ config });
      expect(r.status, r.out).not.toBe(0);
      expect(resourceActions(r).map((c) => composeSub(c.argv))).toEqual([]);
      expect(makeCalls(r)).toEqual([]);
      expect(r.out).toMatch(/REFUSING/);
    });
  }
});

describe("R-ADV creation evidence and anonymous mounts", () => {
  for (const damage of ["missing", "incomplete", "manifest"]) {
    it(`B1 ${damage}: retains resources, claim and mutex without reconstruction`, () => {
      const r = runRunner({ env: { STUB_RECORD_DAMAGE: damage } });
      expect(r.status, r.out).not.toBe(0);
      expect(
        r.calls.filter((c) => c.tool === "docker" && (c.argv[0] === "rm" || c.argv[1] === "rm"))
      ).toEqual([]);
      expect(existsSync(lockOf(r.root))).toBe(true);
      expect(r.out).toMatch(/TEARDOWN REFUSED/);
    });
  }
  for (const label of ["scratch-e2e", "-"]) {
    it(`B3 anonymous mount, project label ${label}: refuses before any removal`, () => {
      const r = runRunner({ env: { STUB_ANONYMOUS: label } });
      expect(r.status, r.out).not.toBe(0);
      expect(
        r.calls.filter((c) => c.tool === "docker" && (c.argv[0] === "rm" || c.argv[1] === "rm"))
      ).toEqual([]);
      expect(existsSync(lockOf(r.root))).toBe(true);
    });
  }
});

describe("full-run.sh refuses leftovers instead of deleting them [Q2(b)]", () => {
  // OSS-MINT-GUARD-5 (R1): the operator's command removes each labelled
  // leftover by its own name. A project-level `down --volumes` is never
  // offered: it removes the config's volume and network names, which this
  // harness no longer creates, so a volume holding one is not the harness's.
  const cases: Record<string, { env: Record<string, string>; command: string | null }> = {
    "a labelled container": {
      env: { STUB_CONTAINERS: "scratch-e2e-mail-sink-1\\tscratch-e2e\\n" },
      command: "docker rm -f -v scratch-e2e-mail-sink-1",
    },
    "a labelled volume": {
      env: { STUB_VOLUMES: "scratch-e2e_postgres-idp-oss-data-v18_0123\\n" },
      command: "docker volume rm scratch-e2e_postgres-idp-oss-data-v18_0123",
    },
    "a labelled network": {
      env: { STUB_NETWORKS: "scratch-e2e_default_0123\\n" },
      command: "docker network rm scratch-e2e_default_0123",
    },
    "a same-named container of another project": {
      env: { STUB_CONTAINERS: "scratch-e2e-postgres\\tsomeone-else\\n" },
      command: null,
    },
  };
  for (const [label, { env, command }] of Object.entries(cases)) {
    it(`${label}: refuses with the operator's explicit command and runs nothing destructive`, () => {
      const r = runRunner({ env });
      expect(r.status, r.out).not.toBe(0);
      expect(resourceActions(r)).toEqual([]);
      expect(makeCalls(r)).toEqual([]);
      expect(removals(r)).toEqual([]);
      expect(r.out).toMatch(/REFUSING/);
      expect(r.out, "no project-level down is offered").not.toMatch(/ down --volumes/);
      if (command) expect(r.out).toContain(`  ${command}\n`);
      else
        expect(r.out, "nothing of another project is offered for removal").not.toMatch(
          /docker (rm|volume rm|network rm) /
        );
    });
  }
});

describe("full-run.sh inspects every expected name and holds one invocation claim [G2]", () => {
  const OSS_UP = (r: RunResult) => makeCalls(r).filter((c) => c.argv.includes("oss-up"));
  const DOWN_COMMAND = /docker compose -p scratch-e2e -f \S+ -f \S+ --profile app down --volumes/;

  it("REVIEW-G2: refuses a foreign existing volume with the resolved expected name before startup or teardown [E2E-NAME-OWNERSHIP-1]", () => {
    const r = runRunner({
      env: { STUB_FOREIGN_VOLUMES: "scratch-e2e_postgres-idp-oss-data-v18_@IID@\\n" },
    });
    expect(r.status, "a foreign same-name volume must prevent the run").not.toBe(0);
    expect(OSS_UP(r)).toEqual([]);
    expect(downs(r), "this run did not create the foreign volume").toEqual([]);
    expect(resourceActions(r)).toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toMatch(/scratch-e2e_postgres-idp-oss-data-v18_[0-9a-f]{32} /);
    expect(r.out, "down --volumes would remove it by name; it is not offered").not.toMatch(
      DOWN_COMMAND
    );
  });

  it("refuses a foreign existing network with the resolved expected name before startup or teardown", () => {
    const r = runRunner({ env: { STUB_FOREIGN_NETWORKS: "scratch-e2e_default_@IID@\\n" } });
    expect(r.status, r.out).not.toBe(0);
    expect(OSS_UP(r)).toEqual([]);
    expect(downs(r)).toEqual([]);
    expect(resourceActions(r)).toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toMatch(/scratch-e2e_default_[0-9a-f]{32} /);
  });

  it("an overlapping invocation (lock already held) refuses: no startup, no down, the lock is left alone", () => {
    const r = runRunner({
      arrange: (root) => {
        mkdirSync(lockOf(root));
        writeFileSync(join(lockOf(root), "pid"), "424242\n");
      },
    });
    expect(r.status, r.out).toBe(1);
    expect(makeCalls(r)).toEqual([]);
    expect(downs(r)).toEqual([]);
    expect(composeCalls(r), "nothing of the running invocation is touched").toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toContain(lockOf(r.root));
    expect(
      r.out,
      "SPEC K2: the claim is shared with idp-oss devseed-live and openid-conformance"
    ).toMatch(/idp-oss devseed-live or openid-conformance/);
    expect(existsSync(join(lockOf(r.root), "pid")), "the other invocation's lock stays").toBe(true);
    expect(readFileSync(join(lockOf(r.root), "pid"), "utf8")).toBe("424242\n");
  });

  it("REVIEW-H1: a caller with another TMPDIR meets the same claim, so it refuses before any startup, docker call or teardown", () => {
    for (const tmp of ["another-invocation-tmp", "a-third-tmp"]) {
      const env: Record<string, string> = {};
      const r = runRunner({
        env,
        arrange: (root) => {
          mkdirSync(lockOf(root));
          writeFileSync(join(lockOf(root), "pid"), "424242\n");
          const alternate = join(root, tmp);
          mkdirSync(alternate);
          env.TMPDIR = alternate;
        },
      });
      expect(r.status, "the same Docker project already has an invocation claim").toBe(1);
      expect(makeCalls(r).filter((c) => c.argv.includes("oss-up"))).toEqual([]);
      expect(downs(r), "the second invocation owns no appliance").toEqual([]);
      expect(removals(r)).toEqual([]);
      expect(
        r.calls.filter((c) => c.tool === "docker"),
        "no docker call at all"
      ).toEqual([]);
      expect(r.out).toContain(lockOf(r.root));
      expect(existsSync(join(r.root, tmp, LOCK)), "no claim is taken under TMPDIR").toBe(false);
      expect(readFileSync(join(lockOf(r.root), "pid"), "utf8")).toBe("424242\n");
    }
  });

  it("releases its lock at the end of a green run and after a refusal it made", () => {
    const green = runRunner();
    expect(green.status, green.out).toBe(0);
    expect(existsSync(lockOf(green.root)), "green run released its lock").toBe(false);
    const refused = runRunner({ env: { STUB_FOREIGN_NETWORKS: "scratch-e2e_default_@IID@\\n" } });
    expect(refused.status, refused.out).not.toBe(0);
    expect(existsSync(lockOf(refused.root)), "refusal released its lock").toBe(false);
  });

  it("teardown ownership: an expected volume that appeared WITHOUT the project label is not removed; the run is red", () => {
    const r = runRunner({ env: { STUB_LATE_FOREIGN: "volume" } });
    expect(OSS_UP(r).length, "the run started its appliance").toBe(1);
    expect(r.status, r.out).not.toBe(0);
    expect(downs(r), "no project-level down").toEqual([]);
    expect(
      removals(r).filter((c) => c.argv[0] === "volume"),
      "no removal of a volume this run did not record creating"
    ).toEqual([]);
    expect(remaining(r)).toContain(`v/${volumeOf(r)}`);
    expect(removals(r), "SPEC K5: the whole step is refused; nothing is removed").toEqual([]);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expect(r.out).toContain(volumeOf(r));
    expectRetained(r);
  });
});

describe("full-run.sh removes only what this invocation recorded creating [H2]", () => {
  it("REVIEW-H2 + SPEC-K5: a same-name replacement of the appliance's volume, same project label and same invocation label, refuses the whole teardown; nothing is removed; the run is red", () => {
    const r = runRunner({ env: { STUB_SAME_LABEL_REPLACEMENT: "1" } });
    expect(
      r.calls.some((c) => c.tool === "replaced-by-other-invocation"),
      "control: the daemon model replaced the created volume"
    ).toBe(true);
    expect(
      downs(r),
      "a project label is shared; this replacement was not created by the run"
    ).toEqual([]);
    expect(
      removals(r),
      "SPEC K5: the whole step is refused before the first removal; nothing is removed"
    ).toEqual([]);
    expect(
      remaining(r),
      "the replacement survives, and so do the run's own containers and network"
    ).toEqual(createdPaths(r));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expect(r.out).toContain(`${volumeOf(r)} (replaced since it was recorded`);
    expectRetained(r);
  });

  it("REVIEW-H2 + SPEC-K5: a foreign container of the same project refuses the whole teardown; neither it nor the run's own resources are removed; the claim, mutex and record are kept", () => {
    const r = runRunner({ env: { STUB_FOREIGN_CONTAINER: "1" } });
    expect(
      r.calls.some((c) => c.tool === "foreign-container-started"),
      "control: a same-project container appeared during the run"
    ).toBe(true);
    expect(downs(r), "a project-level down would remove it").toEqual([]);
    expect(removals(r), "SPEC K5: nothing is removed").toEqual([]);
    expect(remaining(r), "the foreign container and everything the run created are left").toEqual(
      ["c/f1", ...createdPaths(r)].sort()
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expect(r.out).toMatch(/container f1 \(not recorded as created by this run\)/);
    expectRetained(r);
  });

  it("the recorded identities are the ones removed: a container whose invocation label changed refuses the whole teardown, and nothing is removed", () => {
    const r = runRunner({
      env: { STUB_FAIL_STEP: "admin-reset" },
      arrange: (root) => {
        // The record is written after the start; this rewrite happens later,
        // through the gate driver, so the model mutates app container c2 then.
        writeFileSync(
          join(root, "identuum-ui/scripts/gate-witness.sh"),
          GW_STUB.replace(
            'log gw "$1"',
            '[ "$1" = finalize ] && echo "scratch-e2e scratch-e2e another-invocation" >"$STUB_STATE/c/c2"\nlog gw "$1"'
          )
        );
      },
    });
    expect(r.status).not.toBe(0);
    expect(removals(r), "SPEC K5: nothing is removed").toEqual([]);
    expect(remaining(r)).toEqual(createdPaths(r));
    expect(r.out).toMatch(/container c2 \(its identity changed since it was recorded\)/);
    expectRetained(r);
  });
});

describe("full-run.sh removes a volume only under its own invocation-unique name [R1]", () => {
  it("REVIEW-R1: the volume and the network it creates carry the invocation id in their names, and the only volume removal names that volume", () => {
    const r = runRunner();
    expect(r.status, r.out).toBe(0);
    const iid = invocationOf(r);
    expect(iid, "a 32-hex invocation id reached the startup").toMatch(/^[0-9a-f]{32}$/);
    expect(r.calls.find((c) => c.tool === "created-names")?.argv).toEqual([
      `scratch-e2e_postgres-idp-oss-data-v18_${iid}`,
      `scratch-e2e_default_${iid}`,
    ]);
    expect(removals(r).filter((c) => c.argv[0] === "volume")).toHaveLength(1);
    for (const c of removals(r).filter((c) => c.argv[0] === "volume")) {
      expect(c.argv.at(-1), "a volume is removed only by a name carrying this run's id").toBe(
        volumeOf(r)
      );
    }
  });

  it("REVIEW-R1 shared-name control (E-RACE under the configured name): another writer replaces the volume, under the name the project's config resolves to, after the final identity inspection and before the removal; the replacement survives and the run is red", () => {
    const r = runRunner({ env: { STUB_REPLACE_AFTER_INSPECT: "1" } });
    expect(
      r.calls.some((c) => c.tool === "replaced-after-inspect"),
      "control: the daemon model replaced the volume after the final inspection"
    ).toBe(true);
    expect(
      removals(r)
        .filter((c) => c.argv[0] === "volume")
        .map((c) => c.argv.join(" ")),
      "the removal names only this invocation's own volume"
    ).toEqual([`volume rm ${volumeOf(r)}`]);
    expect(remaining(r), "the other writer's volume survives").toEqual([
      "v/scratch-e2e_postgres-idp-oss-data-v18",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expectRetained(r);
  });

  it("REVIEW-R1 accepted residual (judge ruling Q3 (a)): a writer that copies this run's exact volume name after the final identity inspection has its volume removed by that name, and the run is not red", () => {
    const r = runRunner({ env: { STUB_REPLACE_AFTER_INSPECT: "exact" } });
    expect(
      r.calls.some((c) => c.tool === "replaced-after-inspect-exact"),
      "control: the daemon model replaced the volume under this run's exact name"
    ).toBe(true);
    expect(
      removals(r)
        .filter((c) => c.argv[0] === "volume")
        .map((c) => c.argv.join(" ")),
      "the one removal names this run's exact name"
    ).toEqual([`volume rm ${volumeOf(r)}`]);
    expect(remaining(r), "the copied-name replacement is removed: the documented residual").toEqual(
      []
    );
    expect(r.status, r.out).toBe(0);
  });

  it("a recorded volume whose name does not carry the invocation id refuses the whole teardown (nothing removed by name or ID); the run is red", () => {
    const r = runRunner({ env: { STUB_IGNORE_OVERLAY_NAMES: "1" } });
    expect(removals(r)).toEqual([]);
    expect(remaining(r)).toEqual(
      ["c/c1", "c/c2", "c/c3", "n/n1", "v/scratch-e2e_postgres-idp-oss-data-v18"].sort()
    );
    expectRetained(r);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expect(r.out).toMatch(/creation record is missing or incomplete/);
  });
});

// GUARD6 fixtures follow the existing private runner/state model. No daemon call.
describe("GUARD6 F1: COMPOSE_CMD cannot select an unchecked engine", () => {
  for (const selector of ["--host", "-H", "--context", "-c"]) {
    for (const form of ["env", "command", "env-e", "nested"]) {
      it(`GUARD6-F1/${form}/${selector}: refuses before ANY Docker or nested startup`, () => {
        const value = ["--host", "-H"].includes(selector)
          ? "tcp://model.invalid:2375"
          : "remote-model";
        const r = runRunner({
          env: { COMPOSE_CMD: `docker ${selector} ${value} compose`, STUB_G6_NESTED: "1" },
          parentMake: form === "command" || form === "env-e" ? form : undefined,
        });
        expect(r.status, "unsafe Compose selector must refuse").not.toBe(0);
        expect(
          r.calls.filter((c) => c.tool === "docker"),
          "zero Docker commands"
        ).toEqual([]);
        expect(makeCalls(r), "zero nested startup").toEqual([]);
        expect(r.out).toMatch(/REFUS|refus/);
      });
    }
  }
  it("GUARD6-F1/supported-control: literal docker compose reaches actual nested oss-up compose recipes pinned to the checked endpoint", () => {
    const r = runRunner({ env: { COMPOSE_CMD: "docker compose", STUB_G6_NESTED: "1" } });
    expect(r.status, r.out).toBe(0);
    expect(r.calls.some((c) => c.tool === "docker" && c.argv.includes("build"))).toBe(true);
    expect(r.calls.some((c) => c.tool === "docker" && c.argv.includes("up"))).toBe(true);
    expect(r.calls.some((c) => c.tool === "unchecked-compose-selected")).toBe(false);
    for (const e of dockerEnv(r).slice(1))
      expect([e.host, e.context]).toEqual(["unix:///var/run/docker.sock", "<unset>"]);
  });
});

describe("GUARD6 F2: mutex and engine identity belong to the daemon", () => {
  const resourceCalls = (r: RunResult) =>
    r.calls.filter(
      (c) => c.tool === "docker" && ["compose", "ps", "volume", "network", "rm"].includes(c.argv[0])
    );
  it("GUARD6-F2/stale: refuses a stale daemon mutex; never breaks or relabels it", () => {
    const l = layout(SAFE_CONFIG);
    mkdirSync(join(l.root, "state/mutex"), { recursive: true });
    writeFileSync(join(l.root, "state/mutex/owner"), "stale-owner\n");
    const r = runRunner({ prepared: l });
    expect(readFileSync(join(l.root, "state/mutex/owner"), "utf8")).toBe("stale-owner\n");
    expect(r.status, "an existing daemon mutex must refuse").not.toBe(0);
    expect(resourceCalls(r), "no resource action before mutex ownership").toEqual([]);
    expect(r.out).toContain("identuum-harness-lock-engine");
  });
  it("GUARD6-F2/engine-change: refuses after daemon ID changes, before later resource/cleanup calls", () => {
    const r = runRunner({ env: { STUB_CHANGE_ENGINE: "1" } });
    const changed = r.calls.findIndex((c) => c.tool === "engine-changed");
    expect(changed, "control: startup changed engine identity").toBeGreaterThan(-1);
    const later = { ...r, calls: r.calls.slice(changed + 1) };
    expect(r.status, "engine change must make the run red").not.toBe(0);
    expect(resourceCalls(later), "nothing touches the replacement daemon").toEqual([]);
    expect(r.out).toMatch(/(daemon|engine).*(chang|ident)/i);
    expect(existsSync(join(r.root, "state/mutex")), "the mutex stays where it was taken").toBe(
      true
    );
    expect(
      r.calls.some((c) => c.tool === "docker" && c.argv[0] === "container" && c.argv[1] === "rm"),
      "the mutex is not removed on a changed engine"
    ).toBe(false);
    expect(existsSync(lockOf(r.root)), "SPEC K2: the claim stays with the mutex").toBe(true);
  });
  it("GUARD6-F2/green: the mutex is taken after the engine id and before any resource call, handed to the nested start, never started, and removed by its ID after the teardown", () => {
    const r = runRunner();
    expect(r.status, r.out).toBe(0);
    const docker = r.calls.filter((c) => c.tool === "docker");
    const create = docker.findIndex((c) => c.argv[0] === "container" && c.argv[1] === "create");
    const firstResource = docker.findIndex((c) =>
      ["compose", "ps", "volume", "network", "rm"].includes(c.argv[0])
    );
    const release = docker.findIndex((c) => c.argv[0] === "container" && c.argv[1] === "rm");
    const removalsAt = docker
      .map((c, i) =>
        c.argv[0] === "rm" || (["volume", "network"].includes(c.argv[0]) && c.argv[1] === "rm")
          ? i
          : -1
      )
      .filter((i) => i >= 0);
    expect(docker[1]?.argv[0], "the engine id is read right after the endpoint").toBe("info");
    expect(create, "the mutex is created").toBeGreaterThan(-1);
    expect(create, "before any resource call").toBeLessThan(firstResource);
    expect(removalsAt.length, "control: the run removed what it created").toBeGreaterThan(0);
    expect(release, "released after the last removal").toBeGreaterThan(Math.max(...removalsAt));
    expect(docker[create].argv).toEqual(
      expect.arrayContaining([
        "--name",
        "identuum-harness-lock-engine",
        "--network=none",
        "--pull=never",
        // SPEC K2: the one reservation names its project and host ports.
        "io.identuum.harness.project=scratch-e2e",
        "io.identuum.harness.ports=15513,17113,17108",
      ])
    );
    expect(docker.some((c) => c.argv.includes("start"))).toBe(false);
    expect(existsSync(join(r.root, "state/mutex")), "released").toBe(false);
    const up = makeCalls(r).find((c) => c.argv.includes("oss-up"));
    expect(up?.argv).toEqual(
      expect.arrayContaining([
        "COMPOSE_CMD=docker compose",
        "IDENTUUM_HARNESS_ENGINE_ID=guard6-engine-a",
        "IDENTUUM_HARNESS_MUTEX_ID=guard6-mutex-id",
      ])
    );
  });
  it("GUARD6-F2/no-image: without the pinned mutex image on the engine, the run is refused before any resource call and pulls nothing", () => {
    const r = runRunner({ env: { STUB_NO_MUTEX_IMAGE: "1" } });
    expect(r.status).not.toBe(0);
    expect(resourceCalls(r)).toEqual([]);
    expect(
      r.calls.some((c) => c.tool === "docker" && (c.argv[0] === "pull" || c.argv[1] === "create"))
    ).toBe(false);
    expect(r.out).toContain("docker pull gcr.io/distroless/static-debian12@sha256:");
    expect(makeCalls(r)).toEqual([]);
    expect(existsSync(lockOf(r.root)), "claim released").toBe(false);
  });
  it("GUARD6-F2/separate-namespaces: second caller refuses while first holds SAME daemon in another /tmp", async () => {
    const first = layout(SAFE_CONFIG);
    const second = layout(SAFE_CONFIG);
    const state = join(first.root, "state");
    const barrier = join(first.root, "barrier");
    mkdirSync(barrier);
    const child = spawn(join(first.bin, "bash"), [join(first.ui, "e2e-full/scripts/full-run.sh")], {
      cwd: first.root,
      env: {
        NODE_ENV: "test",
        PATH: `${first.bin}:/usr/bin:/bin`,
        HOME: first.root,
        TMPDIR: first.root,
        STUB_STATE: state,
        STUB_CONFIG: join(first.root, "config.json"),
        STUB_LOG: first.log,
        STUB_ENV_LOG: join(first.root, "docker-env.log"),
        STUB_OVERLAY: join(lockOf(first.root), "invocation.json"),
        STUB_PAUSE_PREFLIGHT: "1",
        STUB_BARRIER: barrier,
      },
    });
    let output = "";
    child.stdout?.on("data", (b) => {
      output += b.toString();
    });
    child.stderr?.on("data", (b) => {
      output += b.toString();
    });
    const ended = new Promise<number | null>((res) => child.on("close", res));
    let secondResult: RunResult | undefined;
    let firstStatus: number | null = null;
    try {
      for (let i = 0; i < 250 && !existsSync(join(barrier, "ready")); i++)
        await new Promise((res) => setTimeout(res, 10));
      expect(existsSync(join(barrier, "ready")), "control: first paused before resources").toBe(
        true
      );
      expect(existsSync(lockOf(first.root)), "first still holds its local lock").toBe(true);
      expect(lockOf(second.root)).not.toBe(lockOf(first.root));
      secondResult = runRunner({ prepared: second, env: { STUB_STATE: state } });
    } finally {
      writeFileSync(join(barrier, "resume"), "continue\n");
      firstStatus = await ended;
    }
    expect(firstStatus, output).toBe(0);
    expect(secondResult?.status, "same daemon serializes callers across local namespaces").not.toBe(
      0
    );
    if (!secondResult) throw new Error("control: the second caller ran");
    expect(resourceCalls(secondResult), "second reaches no resource call").toEqual([]);
    expect(makeCalls(secondResult)).toEqual([]);
    expect(secondResult.out).toContain("identuum-harness-lock-engine");
    expect(existsSync(join(state, "mutex")), "first releases daemon lock after cleanup").toBe(
      false
    );
  }, 15_000);
});

describe("full-run.sh runs only against this host's own Docker engine [R2, owner topology (b)]", () => {
  // A client on another host reaches this daemon through a remote endpoint
  // (tcp://, ssh://, a context naming one): every such endpoint is refused
  // before any other docker call. Remote schemes do not exhaust the other
  // topologies: a forwarded or shared unix socket is not one, and a caller
  // with another /tmp holds another claim; the GUARD6-F2 cases (daemon mutex,
  // engine id) cover those.
  const refused: Record<string, { env: Record<string, string>; resolved: boolean }> = {
    "DOCKER_HOST over tcp": { env: { DOCKER_HOST: "tcp://192.0.2.10:2376" }, resolved: false },
    "DOCKER_HOST over ssh": { env: { DOCKER_HOST: "ssh://ci@192.0.2.10" }, resolved: false },
    "DOCKER_CONTEXT naming an ssh context": {
      env: { DOCKER_CONTEXT: "remote-builder", STUB_ENDPOINT: "ssh://ci@192.0.2.10" },
      resolved: true,
    },
    "a current context on tcp": { env: { STUB_ENDPOINT: "tcp://192.0.2.10:2375" }, resolved: true },
    "a context that cannot be resolved": {
      env: { DOCKER_CONTEXT: "missing", STUB_CONTEXT_FAIL: "1" },
      resolved: true,
    },
  };
  for (const [label, { env, resolved }] of Object.entries(refused)) {
    it(`REVIEW-R2: ${label} is refused before any other docker call, startup or removal; the claim is released`, () => {
      const r = runRunner({ env });
      expect(r.status, r.out).toBe(1);
      expect(
        r.calls.filter((c) => c.tool === "docker").map((c) => c.argv.slice(0, 2).join(" ")),
        "at most the local context lookup"
      ).toEqual(resolved ? ["context inspect"] : []);
      expect(makeCalls(r)).toEqual([]);
      expect(removals(r)).toEqual([]);
      expect(r.out).toMatch(/REFUSING/);
      expect(r.out).toMatch(/this host's own Docker engine/);
      expect(r.out, "no endpoint value is printed").not.toMatch(/192\.0\.2\.10/);
      expect(existsSync(lockOf(r.root)), "the refusal released its claim").toBe(false);
    });
  }

  it("a local unix-socket context is accepted, and every later docker call runs pinned to that endpoint with no DOCKER_CONTEXT", () => {
    const endpoint = "unix:///home/op/.colima/default/docker.sock";
    const r = runRunner({ env: { DOCKER_CONTEXT: "colima", STUB_ENDPOINT: endpoint } });
    expect(r.status, r.out).toBe(0);
    const env = dockerEnv(r);
    expect(env[0]?.sub, "the endpoint is resolved first").toBe("context");
    expect(env.length).toBeGreaterThan(1);
    for (const e of env.slice(1)) {
      expect([e.sub, e.host, e.context]).toEqual([e.sub, endpoint, "<unset>"]);
    }
  });
});

describe("full-run.sh cleans up exactly once and keeps the run's status [C5]", () => {
  it("nested startup fails before recording: refuses teardown and retains claim and mutex, status 7 kept", () => {
    const r = runRunner({ env: { STUB_FAIL: "oss-up" } });
    expect(r.status, r.out).toBe(7);
    expect(r.calls.some((c) => c.tool === "partial-create")).toBe(true);
    expect(
      r.calls.filter((c) => c.tool === "docker" && (c.argv[0] === "rm" || c.argv[1] === "rm"))
    ).toEqual([]);
    expect(existsSync(lockOf(r.root))).toBe(true);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
  });

  it("the appliance never turns healthy: what it recorded removed by ID, red", () => {
    const r = runRunner({ env: { STUB_CURL_STATUS: "7" } });
    expect(r.status, r.out).toBe(1);
    expectRecordedRemovalAfterCreate(r);
  });

  it("bootstrap exec fails: what it recorded removed by ID, status 5 kept", () => {
    const r = runRunner({ env: { STUB_FAIL: "bootstrap" } });
    expect(r.status, r.out).toBe(5);
    expectRecordedRemovalAfterCreate(r);
  });

  it("the provisioner writes no envelope: what it recorded removed by ID, red", () => {
    const r = runRunner({ env: { STUB_NO_FIXTURE: "1" } });
    expect(r.status, r.out).toBe(1);
    expectRecordedRemovalAfterCreate(r);
  });

  for (const [mode, step] of [
    ["full", "admin-reset"],
    ["quick", "devloop-quick"],
  ] as const) {
    it(`${mode}: a later phase (${step}) fails: what it recorded removed by ID, red`, () => {
      const r = runRunner({ env: { E2E_MODE: mode, STUB_FAIL_STEP: step } });
      expect(r.status, r.out).toBe(1);
      expectPinnedOwnership(r);
      expectRecordedRemovalAfterCreate(r);
    });
  }

  it("a failed teardown turns an otherwise green run red, and keeps the claim, mutex and record", () => {
    const r = runRunner({ env: { STUB_RM_STATUS: "3" } });
    expect(r.status, r.out).not.toBe(0);
    expect(
      removals(r)
        .map((c) => c.argv.join(" "))
        .sort()
    ).toEqual(createdRemovals(r));
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expectRetained(r);
  });

  it("SPEC-K5: a recorded container still present after its removal is red; every recorded object is proved gone before the claim is released", () => {
    const r = runRunner({ env: { STUB_RM_NOOP: "1" } });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/container c1 \(still present after its removal\)/);
    expectRetained(r);
  });

  it("SPEC-K5: a container this run did not create, attached to its recorded network or using its recorded volume, refuses the whole teardown; nothing is removed", () => {
    const r = runRunner({ env: { STUB_FOREIGN_MEMBER: "1" } });
    expect(r.status, r.out).not.toBe(0);
    expect(removals(r)).toEqual([]);
    expect(r.out).toMatch(
      /network n1 \(container fm, not recorded as created by this run, is attached to it\)/
    );
    expect(r.out).toMatch(/uses it\)/);
    expect(remaining(r)).toContain("c/fm");
    expectRetained(r);
  });

  it("SPEC-K4/K6: the kept record's public manifest.json names the engine, endpoint, project, invocation, ports, daemon mutex and every recorded resource", () => {
    const r = runRunner({ env: { STUB_FOREIGN_CONTAINER: "1" } });
    const m = JSON.parse(readFileSync(join(lockOf(r.root), "manifest.json"), "utf8"));
    expect(m).toEqual({
      schema: "identuum.harness.run.v1",
      kind: "e2e-full",
      state: "refused",
      project: "scratch-e2e",
      invocation: invocationOf(r),
      daemon_id: "guard6-engine-a",
      endpoint: "unix:///var/run/docker.sock",
      mutex_id: "guard6-mutex-id",
      ports: [15513, 17113, 17108],
      resources: [
        { kind: "container", id: "c1" },
        { kind: "container", id: "c2" },
        { kind: "container", id: "c3" },
        { kind: "network", id: "n1" },
        { kind: "volume", name: volumeOf(r), created_at: "2026-10-10T00:00:01Z" },
      ],
    });
  });

  it("a failed teardown never masks the original red status", () => {
    const r = runRunner({ env: { STUB_FAIL: "bootstrap", STUB_RM_STATUS: "3" } });
    expect(r.status, r.out).toBe(5);
    expect(
      removals(r)
        .map((c) => c.argv.join(" "))
        .sort()
    ).toEqual(createdRemovals(r));
  });

  // UI-CI-RED-FIX: the teardown runs inside the EXIT trap. Under bash 5.2 and
  // earlier (Ubuntu 24.04 ships 5.2.21), a bare `return` in any function the
  // trap reaches answers the status the script had when the trap fired, not
  // the last command's; bash 5.3 and 3.2 answer the last command's. So the
  // docker() wrapper's bare `return` hid every failed docker call of a green
  // run's teardown and failed every listing of a red run's (nothing removed).
  // The tests above catch it only under such a bash; this one on any bash.
  it("every return in the runner names its status: a bare return reached from the EXIT trap answers the pre-trap status under bash 5.2", () => {
    const bare = /(^|[;{&|]|\bthen|\belse|\bdo)\s*return\s*($|[;}])/;
    expect(bare.test("\t\treturn"), "control: a bare return is found").toBe(true);
    expect(
      bare.test("\tcommand docker; return; }"),
      "control: a bare return mid-line is found"
    ).toBe(true);
    expect(bare.test('\t\treturn "$?"'), "control: a named status is not bare").toBe(false);
    const source = readFileSync(resolve(REPO, "e2e-full/scripts/full-run.sh"), "utf8");
    const found = source
      .split("\n")
      .map((line, i) => `${i + 1}: ${line.replace(/(^|\s)#.*$/, "").trim()}`)
      .filter((line) => bare.test(line.replace(/^\d+: /, "")));
    expect(found, "bare returns in full-run.sh").toEqual([]);
  });
});

// ── the secondary released appliance (identuum-ui-e2e) ──────────────────────

const SECONDARY_SAFE = {
  name: "identuum-ui-e2e",
  services: { postgres: {}, "identuum-idp-oss": {} },
  networks: { default: { name: "identuum-ui-e2e_default" } },
};

interface DockerWorld {
  config?: unknown;
  leftovers?: string;
}

function dockerWorld(world: DockerWorld = {}): (file: string, args: string[]) => string {
  return (file, args) => {
    if (file === "docker" && args[0] === "compose" && args[1] === "version") return "v2";
    if (file === "docker" && (args[0] === "ps" || args[0] === "network"))
      return world.leftovers ?? "";
    if (args.includes("config")) return JSON.stringify(world.config ?? SECONDARY_SAFE);
    return "";
  };
}

const composeLifecycle = () =>
  cp.calls.filter(
    (c) =>
      (c.file === "docker" && c.args[0] === "compose" && !c.args.includes("version")) ||
      (c.file === "docker-compose" && !c.args.includes("version"))
  );

let scratch: string;
let stdoutSpy: { mockRestore: () => void } | undefined;
const savedEnv = { ...process.env };

beforeEach(() => {
  cp.calls.length = 0;
  cp.handler = null;
  reuse.loginWorks = true;
  reuse.siteAdmin = true;
  scratch = mkdtempSync(join(tmpdir(), "e2e-lifecycle-"));
  roots.push(scratch);
  writeFileSync(join(scratch, "ui-runtime.json"), JSON.stringify({ configured: true }));
  process.env.IDENTUUM_UI_CONFIG_FILE = join(scratch, "ui-runtime.json");
  process.env.IDENTUUM_E2E_FIXTURE_FILE = join(scratch, "fixture.json");
  process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE = "true";
  process.env.COMPOSE_PROJECT_NAME = "identuum-idp-oss";
  process.env.COMPOSE_REMOVE_ORPHANS = "true";
  delete process.env.IDENTUUM_E2E_FIXTURE_OWNER;
  delete process.env.IDENTUUM_E2E_KEEP_APPLIANCE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true }))
  );
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  stdoutSpy?.mockRestore();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

async function loadLifecycle() {
  vi.resetModules();
  const setup = (await import("../../e2e/global-setup")).default;
  const teardown = (await import("../../e2e/global-teardown")).default;
  const { composeCommand } = await import("../../e2e/helpers/appliance-fixture");
  return { setup, teardown, composeCommand };
}

describe("composeCommand pins the secondary project [C1]", () => {
  it("docker compose v2 prefix carries -p identuum-ui-e2e", async () => {
    const { composeCommand } = await loadLifecycle();
    cp.handler = dockerWorld();
    expect(composeCommand("/x/docker-compose.e2e.yml")).toEqual([
      "docker",
      "compose",
      "-p",
      "identuum-ui-e2e",
      "-f",
      "/x/docker-compose.e2e.yml",
    ]);
  });

  it("legacy docker-compose prefix carries -p identuum-ui-e2e", async () => {
    const { composeCommand } = await loadLifecycle();
    cp.handler = (file) => {
      if (file === "docker") throw new Error("no v2");
      return "v1";
    };
    expect(composeCommand("/x/docker-compose.e2e.yml")).toEqual([
      "docker-compose",
      "-p",
      "identuum-ui-e2e",
      "-f",
      "/x/docker-compose.e2e.yml",
    ]);
  });
});

describe("outer-owned harness mode: the outer runner owns the lifecycle [C4]", () => {
  beforeEach(() => {
    process.env.IDENTUUM_E2E_FIXTURE_OWNER = "outer";
    process.env.IDENTUUM_IDP_BASE_URL = "http://127.0.0.1:17113";
  });

  it("valid reuse then teardown: zero compose calls, the outer fixture is preserved", async () => {
    const { setup, teardown } = await loadLifecycle();
    writeFileSync(join(scratch, "fixture.json"), "{}");
    cp.handler = dockerWorld();
    await setup();
    await teardown();
    expect(composeLifecycle()).toEqual([]);
    expect(cp.calls, "not even a compose probe").toEqual([]);
    expect(existsSync(join(scratch, "fixture.json")), "fixture kept for the outer run").toBe(true);
  });

  const failures: Record<string, () => void> = {
    "missing fixture": () => {},
    "stale fixture (site_admin cannot sign in)": () => {
      writeFileSync(join(scratch, "fixture.json"), "{}");
      reuse.loginWorks = false;
    },
    "malformed fixture": () => {
      writeFileSync(join(scratch, "fixture.json"), "{}");
      reuse.siteAdmin = false;
    },
    "unhealthy IdP": () => {
      writeFileSync(join(scratch, "fixture.json"), "{}");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false }))
      );
    },
  };
  for (const [label, arrange] of Object.entries(failures)) {
    it(`${label}: setup throws before any compose discovery or startup; teardown stays silent`, async () => {
      const { setup, teardown } = await loadLifecycle();
      arrange();
      cp.handler = dockerWorld();
      await expect(setup()).rejects.toThrow();
      await teardown();
      expect(cp.calls).toEqual([]);
    });
  }
});

describe("standalone mode: own lifecycle only [C4]", () => {
  it("creates its own identuum-ui-e2e appliance and tears exactly that down once", async () => {
    const { setup, teardown } = await loadLifecycle();
    cp.handler = dockerWorld();
    await setup();
    await teardown();
    const life = composeLifecycle();
    const subs = life.map((c) => c.args.find((a) => a === "up" || a === "down" || a === "config"));
    expect(subs.filter((s) => s === "up").length, "one startup").toBe(1);
    expect(subs.filter((s) => s === "down").length, "one teardown").toBe(1);
    for (const c of life) {
      expect(c.args.slice(0, 3)).toEqual(["compose", "-p", "identuum-ui-e2e"]);
      expect(
        c.env?.COMPOSE_PROJECT_NAME,
        "lifecycle env drops the inherited project"
      ).toBeUndefined();
      expect(c.env?.COMPOSE_REMOVE_ORPHANS).toBeUndefined();
    }
    const firstConfig = subs.indexOf("config");
    expect(firstConfig, "resolved config validated before up").toBeGreaterThanOrEqual(0);
    expect(firstConfig).toBeLessThan(subs.indexOf("up"));
    expect(life.some((c) => c.args.includes("-v") || c.args.includes("--volumes"))).toBe(false);
  });

  it("reuses a stack it did not create and never tears it down", async () => {
    const { setup, teardown } = await loadLifecycle();
    writeFileSync(join(scratch, "fixture.json"), "{}");
    cp.handler = dockerWorld();
    await setup();
    await teardown();
    expect(composeLifecycle()).toEqual([]);
  });

  it("refuses a leftover identuum-ui-e2e stack it would have to remove, without removing it", async () => {
    const { setup, teardown } = await loadLifecycle();
    cp.handler = dockerWorld({ leftovers: "identuum-ui-e2e-postgres-1\n" });
    await expect(setup()).rejects.toThrow(/refus/i);
    await teardown();
    expect(
      composeLifecycle().filter((c) => c.args.includes("up") || c.args.includes("down"))
    ).toEqual([]);
  });

  it("refuses a resolved secondary config that names a protected network", async () => {
    const { setup } = await loadLifecycle();
    cp.handler = dockerWorld({
      config: { ...SECONDARY_SAFE, networks: { default: { name: "identuum-idp-oss_default" } } },
    });
    await expect(setup()).rejects.toThrow(/refus/i);
    expect(
      composeLifecycle().filter((c) => c.args.includes("up") || c.args.includes("down"))
    ).toEqual([]);
  });
});
