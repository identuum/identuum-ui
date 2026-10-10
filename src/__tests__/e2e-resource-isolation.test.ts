/**
 * e2e-resource-isolation.test.ts — OSS-MINT-GUARD-2 (C1, C4, C5).
 *
 * Behaviour proofs, all OFFLINE, for the two Compose identities the e2e
 * harnesses own (judge ruling Q2(b)):
 *
 *   - identuum-e2e: e2e-full/scripts/full-run.sh (make e2e-full / e2e-quick).
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
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO = resolve(__dirname, "..", "..");

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
  /** The private layout root; also the runner's TMPDIR, so its lock lives here. */
  root: string;
}

const LOCK = "identuum-e2e.lock";

const SAFE_CONFIG = {
  name: "identuum-e2e",
  services: {
    "postgres-idp-oss": { container_name: "identuum-e2e-postgres" },
    app: { container_name: "identuum-e2e" },
    "mail-sink": {},
  },
  networks: { default: { name: "identuum-e2e_default" } },
  volumes: { "postgres-idp-oss-data-v18": { name: "identuum-e2e_postgres-idp-oss-data-v18" } },
};

const STUB_LOG_LINE = `log() { printf '%s\\t%s\\t%s\\t%s\\t%s\\t' "$1" "\${COMPOSE_PROJECT_NAME-<unset>}" "\${COMPOSE_REMOVE_ORPHANS-<unset>}" "\${MAKEFLAGS-<unset>}" "\${MAKEOVERRIDES-<unset>}" >>"$STUB_LOG"; shift; printf '%s\\037' "$@" >>"$STUB_LOG"; printf '\\n' >>"$STUB_LOG"; }`;

const DOCKER_STUB = `#!/bin/bash
${STUB_LOG_LINE}
log docker "$@"
has() { local want="$1"; shift; for a in "$@"; do [ "$a" = "$want" ] && return 0; done; return 1; }
case "$1" in
compose)
  if has config "$@"; then cat "$STUB_CONFIG"; exit 0; fi
  if has down "$@"; then exit "\${STUB_DOWN_STATUS:-0}"; fi
  if has exec "$@" && [ "\${STUB_FAIL:-}" = bootstrap ]; then exit 5; fi
  exit 0 ;;
ps)
  for a in "$@"; do case "$a" in publish=*) exit 0 ;; esac; done
  printf '%b' "\${STUB_CONTAINERS:-}"; exit 0 ;;
volume | network)
  # The daemon's view: STUB_VOLUMES / STUB_NETWORKS carry this project's label;
  # STUB_FOREIGN_* exist under the same names WITHOUT it (another label or
  # none), so only an UNFILTERED listing shows them. Once the nested startup has
  # run (STUB_CREATED), the appliance's own volume and network exist with the
  # label, unless STUB_LATE_FOREIGN names the kind that appeared without it.
  kind="$1"
  if [ "$kind" = volume ]; then
    own="\${STUB_VOLUMES:-}"; foreign="\${STUB_FOREIGN_VOLUMES:-}"; made=identuum-e2e_postgres-idp-oss-data-v18
  else
    own="\${STUB_NETWORKS:-}"; foreign="\${STUB_FOREIGN_NETWORKS:-}"; made=identuum-e2e_default
  fi
  if has label=com.docker.compose.project=identuum-e2e "$@"; then
    printf '%b' "$own"
    [ -f "$STUB_CREATED" ] && [ "\${STUB_LATE_FOREIGN:-}" != "$kind" ] && echo "$made"
  else
    printf '%b' "$own$foreign"
    [ -f "$STUB_CREATED" ] && echo "$made"
  fi
  exit 0 ;;
inspect) echo "IDENTUUM_IDP_OSS_DB=synthetic-not-a-dsn"; exit 0 ;;
esac
exit 0
`;

const MAKE_STUB = `#!/bin/bash
${STUB_LOG_LINE}
log make "$@"
for a in "$@"; do
  if [ "$a" = oss-up ]; then
    : >"$STUB_CREATED"
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
  copyFileSync(
    resolve(REPO, "e2e-full/scripts/full-run.sh"),
    join(ui, "e2e-full/scripts/full-run.sh")
  );
  copyFileSync(
    resolve(REPO, "e2e-full/compose.mail-sink.yml"),
    join(ui, "e2e-full/compose.mail-sink.yml")
  );
  writeFileSync(join(idp, "deployment/docker-compose.dev.yml"), "services: {}\n");
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
  opts: { config?: unknown; env?: Record<string, string>; arrange?: (root: string) => void } = {}
): RunResult {
  const l = layout(opts.config ?? SAFE_CONFIG);
  opts.arrange?.(l.root);
  const r = spawnSync(join(l.bin, "bash"), [join(l.ui, "e2e-full/scripts/full-run.sh")], {
    cwd: l.root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      PATH: `${l.bin}:/usr/bin:/bin`,
      HOME: l.root,
      TMPDIR: l.root,
      STUB_LOG: l.log,
      STUB_CONFIG: join(l.root, "config.json"),
      STUB_CREATED: join(l.root, "created"),
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
    ).toEqual(["-p", "identuum-e2e"]);
    expect(c.cpn, "no inherited COMPOSE_PROJECT_NAME reaches compose").toBe("<unset>");
    expect(c.cro, "no inherited COMPOSE_REMOVE_ORPHANS reaches compose").toBe("<unset>");
  }
  const startup = makeCalls(r).filter((c) => c.argv.includes("oss-up"));
  expect(startup.length, "one nested oss-up").toBe(1);
  for (const m of makeCalls(r)) {
    expect(m.argv, "nested make names the harness project").toContain(
      "IDENTUUM_IDP_COMPOSE_PROJECT=identuum-e2e"
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

function expectOneOwnedCleanupAfterCreate(r: RunResult): void {
  const d = downs(r);
  expect(d.length, "exactly one owned teardown").toBe(1);
  expect(d[0].argv).toEqual(expect.arrayContaining(["--profile", "app", "down", "--volumes"]));
  expect(d[0].argv.slice(1, 3)).toEqual(["-p", "identuum-e2e"]);
  const create = indexOf(r, (c) => c.tool === "make" && c.argv.includes("oss-up"));
  const down = indexOf(r, (c) => c.tool === "docker" && composeSub(c.argv) === "down");
  expect(create, "the run attempted its startup").toBeGreaterThanOrEqual(0);
  expect(down, "the teardown follows the startup it cleans").toBeGreaterThan(create);
}

describe("full-run.sh owns exactly one Compose project [C1/C5]", () => {
  it("pins every compose action to identuum-e2e, starts nested make under the same project with no inherited selector, and tears its own project down exactly once [E2E-RESOURCE-OWNERSHIP-1]", () => {
    const r = runRunner();
    expect(r.status, r.out).toBe(0);
    expectPinnedOwnership(r);
    expectOneOwnedCleanupAfterCreate(r);
    const down = indexOf(r, (c) => c.tool === "docker" && composeSub(c.argv) === "down");
    expect(down, "the teardown is the last Compose action").toBe(
      r.calls.map((c) => c.tool === "docker" && c.argv[0] === "compose").lastIndexOf(true)
    );
  });

  it("quick mode keeps the same ownership contract", () => {
    const r = runRunner({ env: { E2E_MODE: "quick" } });
    expect(r.status, r.out).toBe(0);
    expectPinnedOwnership(r);
    expectOneOwnedCleanupAfterCreate(r);
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
      volumes: { "postgres-idp-oss-data-v18": { name: "identuum-e2e_x", external: true } },
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
  };
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

describe("full-run.sh refuses leftovers instead of deleting them [Q2(b)]", () => {
  const cases: Record<string, Record<string, string>> = {
    "a labelled container": { STUB_CONTAINERS: "identuum-e2e-mail-sink-1\\tidentuum-e2e\\n" },
    "a labelled volume": { STUB_VOLUMES: "identuum-e2e_postgres-idp-oss-data-v18\\n" },
    "a labelled network": { STUB_NETWORKS: "identuum-e2e_default\\n" },
    "a same-named container of another project": {
      STUB_CONTAINERS: "identuum-e2e-postgres\\tsomeone-else\\n",
    },
  };
  for (const [label, env] of Object.entries(cases)) {
    it(`${label}: refuses with the operator's explicit command and runs nothing destructive`, () => {
      const r = runRunner({ env });
      expect(r.status, r.out).not.toBe(0);
      expect(resourceActions(r)).toEqual([]);
      expect(makeCalls(r)).toEqual([]);
      expect(r.out).toMatch(/REFUSING/);
      expect(r.out).toMatch(
        /docker compose -p identuum-e2e -f \S+ -f \S+ --profile app down --volumes/
      );
    });
  }
});

describe("full-run.sh inspects every expected name and holds one invocation claim [G2]", () => {
  const OSS_UP = (r: RunResult) => makeCalls(r).filter((c) => c.argv.includes("oss-up"));
  const DOWN_COMMAND = /docker compose -p identuum-e2e -f \S+ -f \S+ --profile app down --volumes/;

  it("REVIEW-G2: refuses a foreign existing volume with the resolved expected name before startup or teardown [E2E-NAME-OWNERSHIP-1]", () => {
    const r = runRunner({
      env: { STUB_FOREIGN_VOLUMES: "identuum-e2e_postgres-idp-oss-data-v18\\n" },
    });
    expect(r.status, "a foreign same-name volume must prevent the run").not.toBe(0);
    expect(OSS_UP(r)).toEqual([]);
    expect(downs(r), "this run did not create the foreign volume").toEqual([]);
    expect(resourceActions(r)).toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toMatch(/identuum-e2e_postgres-idp-oss-data-v18/);
    expect(r.out, "down --volumes would remove it by name; it is not offered").not.toMatch(
      DOWN_COMMAND
    );
  });

  it("refuses a foreign existing network with the resolved expected name before startup or teardown", () => {
    const r = runRunner({ env: { STUB_FOREIGN_NETWORKS: "identuum-e2e_default\\n" } });
    expect(r.status, r.out).not.toBe(0);
    expect(OSS_UP(r)).toEqual([]);
    expect(downs(r)).toEqual([]);
    expect(resourceActions(r)).toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toMatch(/identuum-e2e_default/);
  });

  it("an overlapping invocation (lock already held) refuses: no startup, no down, the lock is left alone", () => {
    const r = runRunner({
      arrange: (root) => {
        mkdirSync(join(root, LOCK));
        writeFileSync(join(root, LOCK, "pid"), "424242\n");
      },
    });
    expect(r.status, r.out).toBe(1);
    expect(makeCalls(r)).toEqual([]);
    expect(downs(r)).toEqual([]);
    expect(composeCalls(r), "nothing of the running invocation is touched").toEqual([]);
    expect(r.out).toMatch(/REFUSING/);
    expect(r.out).toContain(join(r.root, LOCK));
    expect(existsSync(join(r.root, LOCK, "pid")), "the other invocation's lock stays").toBe(true);
    expect(readFileSync(join(r.root, LOCK, "pid"), "utf8")).toBe("424242\n");
  });

  it("releases its lock at the end of a green run and after a refusal it made", () => {
    const green = runRunner();
    expect(green.status, green.out).toBe(0);
    expect(existsSync(join(green.root, LOCK)), "green run released its lock").toBe(false);
    const refused = runRunner({ env: { STUB_FOREIGN_NETWORKS: "identuum-e2e_default\\n" } });
    expect(refused.status, refused.out).not.toBe(0);
    expect(existsSync(join(refused.root, LOCK)), "refusal released its lock").toBe(false);
  });

  it("teardown ownership: an expected volume that appeared WITHOUT the project label is not removed; the run is red", () => {
    const r = runRunner({ env: { STUB_LATE_FOREIGN: "volume" } });
    expect(OSS_UP(r).length, "the run started its appliance").toBe(1);
    expect(r.status, r.out).not.toBe(0);
    expect(
      downs(r).filter((c) => c.argv.includes("--volumes")),
      "no down --volumes over a volume this run cannot prove it created"
    ).toEqual([]);
    expect(r.out).toMatch(/TEARDOWN REFUSED/);
    expect(r.out).toMatch(/identuum-e2e_postgres-idp-oss-data-v18/);
  });
});

describe("full-run.sh cleans up exactly once and keeps the run's status [C5]", () => {
  it("nested startup fails after a partial create: one owned down, status 7 kept", () => {
    const r = runRunner({ env: { STUB_FAIL: "oss-up" } });
    expect(r.status, r.out).toBe(7);
    expect(r.calls.some((c) => c.tool === "partial-create")).toBe(true);
    expectOneOwnedCleanupAfterCreate(r);
  });

  it("the appliance never turns healthy: one owned down, red", () => {
    const r = runRunner({ env: { STUB_CURL_STATUS: "7" } });
    expect(r.status, r.out).toBe(1);
    expectOneOwnedCleanupAfterCreate(r);
  });

  it("bootstrap exec fails: one owned down, status 5 kept", () => {
    const r = runRunner({ env: { STUB_FAIL: "bootstrap" } });
    expect(r.status, r.out).toBe(5);
    expectOneOwnedCleanupAfterCreate(r);
  });

  it("the provisioner writes no envelope: one owned down, red", () => {
    const r = runRunner({ env: { STUB_NO_FIXTURE: "1" } });
    expect(r.status, r.out).toBe(1);
    expectOneOwnedCleanupAfterCreate(r);
  });

  for (const [mode, step] of [
    ["full", "admin-reset"],
    ["quick", "devloop-quick"],
  ] as const) {
    it(`${mode}: a later phase (${step}) fails: one owned down, red`, () => {
      const r = runRunner({ env: { E2E_MODE: mode, STUB_FAIL_STEP: step } });
      expect(r.status, r.out).toBe(1);
      expectPinnedOwnership(r);
      expectOneOwnedCleanupAfterCreate(r);
    });
  }

  it("a failed teardown turns an otherwise green run red", () => {
    const r = runRunner({ env: { STUB_DOWN_STATUS: "3" } });
    expect(r.status, r.out).not.toBe(0);
    expect(downs(r).length).toBe(1);
  });

  it("a failed teardown never masks the original red status", () => {
    const r = runRunner({ env: { STUB_FAIL: "bootstrap", STUB_DOWN_STATUS: "3" } });
    expect(r.status, r.out).toBe(5);
    expect(downs(r).length).toBe(1);
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
