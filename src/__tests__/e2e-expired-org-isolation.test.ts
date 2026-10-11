/**
 * e2e-expired-org-isolation.test.ts — OSS-MINT-GUARD-2 (C2).
 *
 * The site-admin expired-pending-org fixture (e2e/helpers/fixture-expired-org.ts)
 * used to run a HOST psql against localhost:5432 and to call fixed HTTP bases
 * (127.0.0.1:7104, 127.0.0.1:7113) from the full dev-loop phase — a path from a
 * disposable mint to whatever database or app answered there. These proofs
 * intercept every process API (execSync, execFileSync, spawn, spawnSync, exec,
 * execFile) and the Playwright request methods; nothing is executed and no
 * socket is opened. Only labels are recorded: the program, the Compose
 * selectors and service, and the SQL operation class — never a SQL literal,
 * credential or token.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO = resolve(__dirname, "..", "..");

const world = vi.hoisted(() => ({
  procs: [] as { api: string; file: string; args: string[] }[],
  sql: (_op: string): string => "",
}));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const record = (api: string) =>
    vi.fn((file: unknown, args?: unknown) => {
      const argv = Array.isArray(args) ? args.map(String) : [];
      // Label the SQL by its operation class only; never keep the statement.
      const labelled = argv.map((a, i) =>
        argv[i - 1] === "-c" ? `SQL:${a.trim().split(/\s+/)[0].toUpperCase()}` : a
      );
      world.procs.push({ api, file: String(file).split(" ")[0], args: labelled });
      if (api !== "execFileSync") throw new Error(`unexpected ${api} in an offline test`);
      const op = labelled.find((a) => a.startsWith("SQL:")) ?? "";
      return Buffer.from(world.sql(op));
    });
  return {
    ...real,
    execSync: record("execSync"),
    execFileSync: record("execFileSync"),
    spawn: record("spawn"),
    spawnSync: record("spawnSync"),
    exec: record("exec"),
    execFile: record("execFile"),
  };
});

// Capture the spec's hook registrations without starting Playwright.
const pw = vi.hoisted(() => ({ beforeAll: [] as ((a: unknown) => Promise<void>)[] }));
vi.mock("@playwright/test", () => {
  const test = Object.assign(() => {}, {
    beforeAll: (fn: (a: unknown) => Promise<void>) => pw.beforeAll.push(fn),
    afterAll: () => {},
    beforeEach: () => {},
    afterEach: () => {},
    describe: Object.assign(() => {}, { serial: () => {}, configure: () => {} }),
    skip: () => {},
    setTimeout: () => {},
    info: () => ({ project: { use: { baseURL: "http://localhost:17108" } } }),
  });
  return { test, expect: () => ({}) };
});
vi.mock("../../e2e/helpers/login", () => ({
  loginAsSiteAdmin: vi.fn(async () => {}),
  SKIP_AUTH_MSG: "skip",
  skipAuthTests: false,
}));

interface Req {
  method: string;
  url: string;
}
const requests: Req[] = [];
let respond: (method: string, url: string) => { status: number; body: unknown } = () => ({
  status: 599,
  body: {},
});

function fakeContext() {
  const call = (method: string) =>
    vi.fn(async (url: string) => {
      requests.push({ method, url });
      const r = respond(method, url);
      return { ok: () => r.status < 300, status: () => r.status, json: async () => r.body };
    });
  return {
    request: { get: call("GET"), post: call("POST"), put: call("PUT"), delete: call("DELETE") },
    newPage: vi.fn(async () => ({ close: vi.fn(async () => {}) })),
    close: vi.fn(async () => {}),
  };
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const HARNESS_KEYS = [
  "IDENTUUM_E2E_FIXTURE_OWNER",
  "IDENTUUM_IDP_COMPOSE_PROJECT",
  "IDENTUUM_E2E_IDP_DIR",
  "IDENTUUM_E2E_BASE_URL",
  "IDENTUUM_E2E_FULL_IDP_BASE",
  "IDENTUUM_E2E_FULL_UI_PORT",
  "IDENTUUM_E2E_FULL_APP_PORT",
];
const saved: Record<string, string | undefined> = {};
let idpDir: string;

beforeEach(() => {
  world.procs.length = 0;
  world.sql = () => "";
  requests.length = 0;
  respond = () => ({ status: 599, body: {} });
  for (const k of HARNESS_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  idpDir = mkdtempSync(join(tmpdir(), "expired-org-"));
  roots.push(idpDir);
  mkdirSync(join(idpDir, "deployment"), { recursive: true });
  writeFileSync(join(idpDir, "deployment", "docker-compose.dev.yml"), "services: {}\n");
});

afterEach(() => {
  for (const k of HARNESS_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function harness(): void {
  process.env.IDENTUUM_E2E_FIXTURE_OWNER = "outer";
  process.env.IDENTUUM_IDP_COMPOSE_PROJECT = "scratch-e2e";
  process.env.IDENTUUM_E2E_IDP_DIR = idpDir;
  process.env.IDENTUUM_E2E_BASE_URL = "http://localhost:17108";
  process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://127.0.0.1:17113";
  // The selected owned harness endpoints full-run.sh carries (G4).
  process.env.IDENTUUM_E2E_FULL_UI_PORT = "17108";
  process.env.IDENTUUM_E2E_FULL_APP_PORT = "17113";
}

async function helper() {
  vi.resetModules();
  return (await import("../../e2e/helpers/fixture-expired-org")).ensureExpiredPendingOrgFixture;
}

function expectScratchOnly(): void {
  expect(world.procs.length, "the fixture reached the scratch database").toBeGreaterThan(0);
  const overlay = resolve(REPO, "e2e-full", "compose.mail-sink.yml");
  for (const p of world.procs) {
    expect(p.api, "argv only, no shell").toBe("execFileSync");
    expect(p.file).toBe("docker");
    expect(p.args.slice(0, 12)).toEqual([
      "compose",
      "-p",
      "scratch-e2e",
      "-f",
      join(idpDir, "deployment", "docker-compose.dev.yml"),
      "-f",
      overlay,
      "--profile",
      "app",
      "exec",
      "-T",
      "postgres-idp-oss",
    ]);
    expect(p.args[12]).toBe("psql");
    expect(p.args, "no host/port selection: the container's own socket").not.toContain("-h");
    expect(p.args.join(" ")).not.toMatch(/5432|5513|localhost/);
  }
  for (const r of requests) {
    expect(
      r.url.startsWith("http://localhost:17108/api/idp/") ||
        r.url.startsWith("http://127.0.0.1:17113/"),
      `${r.method} uses a configured harness base`
    ).toBe(true);
  }
}

describe("no harness context, no external call [C2]", () => {
  it("refuses before any process, psql or HTTP request when the outer-owned scratch harness is absent [E2E-NO-LOCAL-DB-1]", async () => {
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).rejects.toThrow(/refus/i);
    expect(world.procs, "no process API was called").toEqual([]);
    expect(requests, "no HTTP request was made").toEqual([]);
  });

  const partial: Record<string, () => void> = {
    "another project": () => {
      process.env.IDENTUUM_IDP_COMPOSE_PROJECT = "identuum-idp-oss";
    },
    "no idp-oss checkout": () => {
      delete process.env.IDENTUUM_E2E_IDP_DIR;
    },
    "no UI base": () => {
      delete process.env.IDENTUUM_E2E_BASE_URL;
    },
    "no IdP base": () => {
      delete process.env.IDENTUUM_E2E_FULL_IDP_BASE;
    },
  };
  for (const [label, spoil] of Object.entries(partial)) {
    it(`${label}: refuses with zero calls`, async () => {
      harness();
      spoil();
      const ensure = await helper();
      await expect(ensure(fakeContext() as never)).rejects.toThrow(/refus/i);
      expect(world.procs).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
});

describe("the bases must be the selected owned harness endpoints [G4]", () => {
  async function expectRefusedWithZeroCalls(): Promise<void> {
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).rejects.toThrow(/refus/i);
    expect(world.procs, "refused before the database command").toEqual([]);
    expect(requests, "refused before HTTP").toEqual([]);
  }

  it("REVIEW-G4: refuses off-harness HTTP origins before any process or request [E2E-FIXTURE-ENDPOINT-1]", async () => {
    harness();
    process.env.IDENTUUM_E2E_BASE_URL = "http://localhost:7104";
    process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://127.0.0.1:7113";
    await expectRefusedWithZeroCalls();
  });

  const spoiled: Record<string, () => void> = {
    "a non-loopback UI base": () => {
      process.env.IDENTUUM_E2E_BASE_URL = "http://ui.example.test:17108";
    },
    "a non-loopback IdP base": () => {
      process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://10.0.0.5:17113";
    },
    "an IdP base whose port disagrees with the selected app port": () => {
      process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://127.0.0.1:17114";
    },
    "a UI base whose port disagrees with the selected UI port": () => {
      process.env.IDENTUUM_E2E_BASE_URL = "http://localhost:17109";
    },
    "the selected UI port missing": () => {
      delete process.env.IDENTUUM_E2E_FULL_UI_PORT;
    },
    "the selected app port missing": () => {
      delete process.env.IDENTUUM_E2E_FULL_APP_PORT;
    },
    "a selected app port of 7113 (the owner's dev app), even with an agreeing base": () => {
      process.env.IDENTUUM_E2E_FULL_APP_PORT = "7113";
      process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://127.0.0.1:7113";
    },
    "a selected UI port of 7104 (the owner's dev UI), even with an agreeing base": () => {
      process.env.IDENTUUM_E2E_FULL_UI_PORT = "7104";
      process.env.IDENTUUM_E2E_BASE_URL = "http://localhost:7104";
    },
    "a selected port that is not plain decimal": () => {
      process.env.IDENTUUM_E2E_FULL_APP_PORT = "0x4469";
    },
    "a base carrying userinfo": () => {
      process.env.IDENTUUM_E2E_FULL_IDP_BASE = "http://user@127.0.0.1:17113";
    },
    "an https base": () => {
      process.env.IDENTUUM_E2E_BASE_URL = "https://localhost:17108";
    },
  };
  for (const [label, spoil] of Object.entries(spoiled)) {
    it(`${label}: refuses with zero calls`, async () => {
      harness();
      spoil();
      await expectRefusedWithZeroCalls();
    });
  }
});

describe("valid synthetic harness context: scratch project only [C2]", () => {
  const ORG = "11111111-2222-4333-8444-555555555555";

  it("fresh appliance: creates the org through the harness UI and expires inside scratch-e2e", async () => {
    harness();
    world.sql = (op) => (op === "SQL:SELECT" ? "" : "UPDATE 1");
    respond = (method) =>
      method === "POST"
        ? { status: 201, body: { organization: { id: ORG } } }
        : { status: 200, body: { organizations: [] } };
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).resolves.toBe(ORG);
    expectScratchOnly();
    expect(world.procs.map((p) => p.args.find((a) => a.startsWith("SQL:")))).toEqual([
      "SQL:SELECT",
      "SQL:UPDATE",
    ]);
  });

  it("active fixture user: resets inside scratch-e2e and finds the org through the harness UI", async () => {
    harness();
    world.sql = (op) => (op === "SQL:SELECT" ? "active" : "UPDATE 1");
    respond = () => ({
      status: 200,
      body: { organizations: [{ id: ORG, domain: "playwright-expired.local" }] },
    });
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).resolves.toBe(ORG);
    expectScratchOnly();
  });

  it("domain conflict: the claim goes to the harness IdP base, never a fixed port", async () => {
    harness();
    world.sql = (op) => (op === "SQL:SELECT" ? "" : "UPDATE 1");
    respond = (method, url) => {
      if (method === "POST" && url.endsWith("/api/v1/organizations"))
        return { status: 409, body: {} };
      if (method === "GET")
        return {
          status: 200,
          body: { organizations: [{ id: ORG, domain: "playwright-expired.local" }] },
        };
      if (url.endsWith("/invitations"))
        return { status: 200, body: { claim_url: "http://ui.invalid/claim?token=synthetic" } };
      return { status: 200, body: {} };
    };
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).resolves.toBe(ORG);
    expectScratchOnly();
    expect(requests.some((r) => r.url === "http://127.0.0.1:17113/api/v1/auth/claim")).toBe(true);
  });

  it("a failing scratch query is an error, never read as 'no fixture yet'", async () => {
    harness();
    world.sql = () => {
      throw new Error("psql failed (synthetic)");
    };
    const ensure = await helper();
    await expect(ensure(fakeContext() as never)).rejects.toThrow();
    expect(requests, "nothing was created after the failed query").toEqual([]);
  });
});

describe("site-admin-organizations beforeAll does not swallow a refusal [C2]", () => {
  async function capturedBeforeAll() {
    vi.resetModules();
    pw.beforeAll.length = 0;
    await import("../../e2e/site-admin-organizations.spec");
    expect(pw.beforeAll.length, "the spec registers its beforeAll").toBe(1);
    return pw.beforeAll[0];
  }
  const browser = { newContext: vi.fn(async () => fakeContext()) };
  beforeEach(() => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    return () => spy.mockRestore();
  });

  it("under the outer-owned harness, an isolation refusal fails the hook", async () => {
    harness();
    process.env.IDENTUUM_IDP_COMPOSE_PROJECT = "identuum-idp-oss";
    const hook = await capturedBeforeAll();
    await expect(hook({ browser })).rejects.toThrow(/refus/i);
    expect(world.procs).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("outside the harness the fixture is not attempted: no process, no request (its tests self-skip)", async () => {
    const hook = await capturedBeforeAll();
    await expect(hook({ browser })).resolves.toBeUndefined();
    expect(world.procs).toEqual([]);
    expect(requests).toEqual([]);
  });
});
