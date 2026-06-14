/**
 * Unit tests for src/lib/idp-upgrade-client.ts.
 *
 * Mocks global fetch. Each test pins one discriminated-union variant
 * of getUpgradeStatus / getUpgradePreflight / applyUpgrade so the
 * /upgrade wizard can rely on narrow result shapes when rendering
 * branch-specific UI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUpgrade,
  getUpgradePreflight,
  getUpgradeStatus,
  upgradeStateNeedsWizard,
} from "../lib/idp-upgrade-client";

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) =>
      handler(url, init)
    ) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUpgradeStatus", () => {
  it("returns ok+status on the oss_database_detected body shape", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "oss_database_detected",
          product: "identuum-idp-ce",
          distribution: "ce",
          upgrade_available: true,
          ce_migrations_current: false,
          oss_database_detected: true,
          backup_required: true,
          pending_count: 7,
          applied_version: "0021",
          target_version: "0028",
          next_action: "Existing OSS deployment detected.",
        })
      )
    );
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("oss_database_detected");
    expect(got.status.distribution).toBe("ce");
    expect(got.status.upgradeAvailable).toBe(true);
    expect(got.status.ossDatabaseDetected).toBe(true);
    expect(got.status.backupRequired).toBe(true);
    expect(got.status.pendingCount).toBe(7);
    expect(got.status.appliedVersion).toBe("0021");
    expect(got.status.targetVersion).toBe("0028");
  });

  it("projects the upgrade_complete body shape", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "upgrade_complete",
          product: "identuum-idp-ce",
          distribution: "ce",
          upgrade_available: false,
          ce_migrations_current: true,
          oss_database_detected: true,
          backup_required: false,
          pending_count: 0,
          next_action: "Upgrade complete.",
        })
      )
    );
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("upgrade_complete");
    expect(got.status.ceMigrationsCurrent).toBe(true);
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network failure")));
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("", { status: 500 }))
    );
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(500);
  });

  it("returns error on unknown state value", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, { state: "made_up", product: "x", distribution: "ce" }))
    );
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("error");
  });

  it("returns error on non-object body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, [1, 2, 3]))
    );
    const got = await getUpgradeStatus();
    expect(got.kind).toBe("error");
  });

  it("uses the same-origin proxy path", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, {
          state: "fresh_ce",
          product: "identuum-idp-ce",
          distribution: "ce",
        });
      })
    );
    await getUpgradeStatus();
    expect(calls[0]).toBe("/api/idp/api/upgrade/status");
  });
});

describe("getUpgradePreflight", () => {
  it("returns ok+preflight on the standard body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "oss_database_detected",
          ready: false,
          backup_confirmed: false,
          backup_required: true,
          next_action: "Confirm backup",
          checks: [
            { id: "database_reachable", ok: true, label: "Database reachable" },
            {
              id: "ce_migrations_available",
              ok: true,
              label: "CE schema upgrade available",
              detail: "7 CE migration(s) embedded; 7 pending.",
            },
            { id: "backup_confirmed", ok: false, label: "Database backup confirmed" },
          ],
        })
      )
    );
    const got = await getUpgradePreflight(false);
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.preflight.state).toBe("oss_database_detected");
    expect(got.preflight.ready).toBe(false);
    expect(got.preflight.checks).toHaveLength(3);
    expect(got.preflight.checks[1]?.detail).toContain("CE migration");
  });

  it("forwards backup_confirmed in the request body", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch((_url, init) => {
        if (typeof init?.body === "string") bodies.push(init.body);
        return jsonResponse(200, { state: "oss_database_detected", checks: [] });
      })
    );
    await getUpgradePreflight(true);
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ backup_confirmed: true });
  });

  it("returns database_unreachable on 503 with stable error code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(503, {
          error: "database_unreachable",
          next_action: "Confirm the database service is running.",
        })
      )
    );
    const got = await getUpgradePreflight(false);
    expect(got.kind).toBe("database_unreachable");
    if (got.kind !== "database_unreachable") return;
    expect(got.message).toContain("Confirm the database");
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network failure")));
    const got = await getUpgradePreflight(false);
    expect(got.kind).toBe("unreachable");
  });

  it("drops malformed check entries", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "fresh_ce",
          checks: [
            null,
            { id: "good", ok: true, label: "Good" },
            { id: "missing-label", ok: true },
            "string-item",
          ],
        })
      )
    );
    const got = await getUpgradePreflight(false);
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.preflight.checks).toHaveLength(1);
    expect(got.preflight.checks[0]?.id).toBe("good");
  });
});

describe("applyUpgrade", () => {
  it("returns ok+result on a successful upgrade_complete response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "upgrade_complete",
          applied_migrations_count: 7,
          embedded_migrations_count: 7,
          applied_version: "0028",
          target_version: "0028",
          next_action: "Upgrade complete. Restart the CE service.",
        })
      )
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "TOKEN" });
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.result.state).toBe("upgrade_complete");
    expect(got.result.appliedMigrationsCount).toBe(7);
  });

  it("returns ok+result on the idempotent ce_migrations_current branch", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "ce_migrations_current",
          applied_migrations_count: 0,
          embedded_migrations_count: 28,
        })
      )
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "" });
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.result.state).toBe("ce_migrations_current");
    expect(got.result.appliedMigrationsCount).toBe(0);
  });

  it("returns rejected{backup_confirmation_required} on 400 with that code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(400, {
          error: "backup_confirmation_required",
          next_action: "Confirm a database backup before continuing.",
        })
      )
    );
    const got = await applyUpgrade({ backupConfirmed: false, upgradeToken: "x" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("backup_confirmation_required");
    expect(got.message).toContain("Confirm a database");
  });

  it("returns rejected{upgrade_token_required} on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "upgrade_token_required" }))
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("upgrade_token_required");
  });

  it("returns rejected{incompatible_database} on 409", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(409, { error: "incompatible_database" }))
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("incompatible_database");
  });

  it("returns rejected{database_unreachable} on 503 with that code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(503, {
          error: "database_unreachable",
          next_action: "Confirm the database service is running.",
        })
      )
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("database_unreachable");
  });

  it("returns rejected{upgrade_apply_failed} on 503 with that code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(503, { error: "upgrade_apply_failed" }))
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("upgrade_apply_failed");
  });

  it("returns error on unknown non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("", { status: 502 }))
    );
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(502);
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network failure")));
    const got = await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(got.kind).toBe("unreachable");
  });

  it("uses the same-origin apply proxy path", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, {
          state: "ce_migrations_current",
          applied_migrations_count: 0,
          embedded_migrations_count: 0,
        });
      })
    );
    await applyUpgrade({ backupConfirmed: true, upgradeToken: "x" });
    expect(calls[0]).toBe("/api/idp/api/upgrade/apply");
  });

  it("forwards backup_confirmed and upgrade_token in the body", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch((_url, init) => {
        if (typeof init?.body === "string") bodies.push(init.body);
        return jsonResponse(200, {
          state: "ce_migrations_current",
          applied_migrations_count: 0,
          embedded_migrations_count: 0,
        });
      })
    );
    await applyUpgrade({ backupConfirmed: true, upgradeToken: "ABC123" });
    const parsed = JSON.parse(bodies[0] ?? "{}");
    expect(parsed).toEqual({ backup_confirmed: true, upgrade_token: "ABC123" });
  });
});

describe("upgradeStateNeedsWizard", () => {
  it("returns true for states that need operator action", () => {
    expect(upgradeStateNeedsWizard("fresh_ce")).toBe(true);
    expect(upgradeStateNeedsWizard("oss_database_detected")).toBe(true);
    expect(upgradeStateNeedsWizard("upgrade_required")).toBe(true);
    expect(upgradeStateNeedsWizard("incompatible_database")).toBe(true);
    expect(upgradeStateNeedsWizard("database_unreachable")).toBe(true);
    expect(upgradeStateNeedsWizard("backup_required")).toBe(true);
  });
  it("returns false for terminal/no-op states", () => {
    expect(upgradeStateNeedsWizard("ce_migrations_current")).toBe(false);
    expect(upgradeStateNeedsWizard("upgrade_complete")).toBe(false);
  });
});
