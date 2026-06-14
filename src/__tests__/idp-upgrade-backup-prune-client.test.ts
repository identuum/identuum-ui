/**
 * Unit tests for the prune-backup + extended listing helpers added
 * to `src/lib/idp-upgrade-client.ts` in the 2026-06-17 backup
 * retention / pruning slice. Covers:
 *
 *   - `isProductBackupFilename` accepts the exact server pattern
 *     and rejects every traversal / hidden / wrong-shape variant.
 *   - `pruneBackup` short-circuits on a client-side invalid
 *     filename without firing the network call.
 *   - `pruneBackup` happy path returns `{kind: "ok"}` with the
 *     backend-supplied filename verbatim.
 *   - `pruneBackup` maps every wire-code rejection to the matching
 *     discriminated-union variant.
 *   - `getBackupStatus` projects the new `backups[]` array with the
 *     `isLatest` flag, drops malformed entries, and preserves
 *     legacy responses that omit `backups` entirely.
 *   - The wizard never sends a non-product-shaped filename through
 *     the prune endpoint — the request body is asserted directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBackupStatus, isProductBackupFilename, pruneBackup } from "../lib/idp-upgrade-client";

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

const VALID_NAME = "identuum-idp-ce-upgrade-backup-20260617T080000Z-deadbeef.sql";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isProductBackupFilename", () => {
  it("accepts a product-shape filename", () => {
    expect(isProductBackupFilename(VALID_NAME)).toBe(true);
  });

  const rejected = [
    "",
    "..",
    "../etc/passwd",
    "../../etc/passwd",
    "/etc/passwd",
    `subdir/${VALID_NAME}`,
    `.${VALID_NAME}`,
    VALID_NAME.replace("deadbeef", "DEADBEEF"),
    VALID_NAME.replace(".sql", ".tar"),
    VALID_NAME.replace("identuum-idp-ce-upgrade-backup-", "evil-"),
    `${VALID_NAME}\x00.txt`,
    `${VALID_NAME} `,
    ` ${VALID_NAME}`,
    `${VALID_NAME}\n`,
    null,
    undefined,
    42,
    {},
  ];
  for (const candidate of rejected) {
    it(`rejects ${JSON.stringify(candidate)}`, () => {
      expect(isProductBackupFilename(candidate)).toBe(false);
    });
  }
});

describe("pruneBackup", () => {
  it("short-circuits on a client-side invalid filename WITHOUT firing fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const got = await pruneBackup("../etc/passwd");
    expect(f).not.toHaveBeenCalled();
    expect(got).toEqual({
      kind: "rejected",
      code: "backup_filename_invalid",
      message: expect.stringContaining("product-managed backup"),
    });
  });

  it("happy path: 200 returns {kind: ok} with the backend's filename verbatim", async () => {
    let posted: string | undefined;
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) => {
        expect(url).toBe("/api/idp/api/upgrade/backup/prune");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
        posted = init?.body as string;
        return jsonResponse(200, {
          filename: VALID_NAME,
          backup_directory: "/app/data/backups/upgrade",
          next_action: "Backup deleted.",
        });
      })
    );
    const got = await pruneBackup(VALID_NAME);
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.result.filename).toBe(VALID_NAME);
    expect(got.result.backupDirectory).toBe("/app/data/backups/upgrade");
    if (typeof posted !== "string") throw new Error("fetch did not capture body");
    expect(JSON.parse(posted)).toEqual({ filename: VALID_NAME });
  });

  it("never includes a path-separator in the JSON body", async () => {
    let posted: string | undefined;
    vi.stubGlobal(
      "fetch",
      mockFetch((_url, init) => {
        posted = init?.body as string;
        return jsonResponse(200, {
          filename: VALID_NAME,
          backup_directory: "/app/data/backups/upgrade",
          next_action: "Backup deleted.",
        });
      })
    );
    await pruneBackup(VALID_NAME);
    if (typeof posted !== "string") throw new Error("fetch did not capture body");
    expect(posted).not.toContain("/");
    expect(posted).not.toContain("\\");
    expect(posted).not.toContain("..");
  });

  const failureCases: Array<{
    status: number;
    code: string;
    reason?: string;
    next_action?: string;
  }> = [
    { status: 400, code: "backup_filename_invalid", next_action: "filename invalid" },
    { status: 400, code: "filename_required", next_action: "missing filename" },
    { status: 400, code: "invalid_request", next_action: "bad body" },
    { status: 404, code: "backup_not_found", next_action: "no such file" },
    {
      status: 503,
      code: "backup_automation_unavailable",
      reason: "data_dir_unsafe",
      next_action: "data dir 0777",
    },
    { status: 500, code: "backup_prune_failed", next_action: "rm failed" },
  ];
  for (const fc of failureCases) {
    it(`maps wire error ${fc.code} → kind: rejected`, async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(() =>
          jsonResponse(fc.status, {
            error: fc.code,
            reason: fc.reason,
            next_action: fc.next_action,
          })
        )
      );
      const got = await pruneBackup(VALID_NAME);
      expect(got.kind).toBe("rejected");
      if (got.kind !== "rejected") return;
      expect(got.code).toBe(fc.code);
      if (fc.reason) expect(got.reason).toBe(fc.reason);
      expect(got.message).toBe(fc.next_action ?? "");
    });
  }

  it("maps unknown wire error → kind: error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(418, {
          error: "teapot_mode",
          next_action: "i am a teapot",
        })
      )
    );
    const got = await pruneBackup(VALID_NAME);
    expect(got).toEqual({ kind: "error", status: 418 });
  });

  it("maps network failure → kind: unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => {
        throw new Error("network down");
      })
    );
    const got = await pruneBackup(VALID_NAME);
    expect(got).toEqual({ kind: "unreachable" });
  });

  it("maps malformed success body → kind: error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          /* missing filename */
          backup_directory: "/x",
        })
      )
    );
    const got = await pruneBackup(VALID_NAME);
    expect(got).toEqual({ kind: "error", status: 200 });
  });
});

describe("getBackupStatus — extended for backups[] list", () => {
  it("projects the newest-first backups[] array with isLatest on the first entry", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        expect(url).toBe("/api/idp/api/upgrade/backup");
        return jsonResponse(200, {
          automation_available: true,
          backup_directory: "/app/data/backups/upgrade",
          next_action: "A local backup is ready.",
          latest_backup: {
            backup_id: "0192-newest",
            filename: VALID_NAME,
            created_at: "2026-06-17T08:00:00Z",
            size_bytes: 9148,
            format: "pg_dump_plain_sql",
            is_latest: true,
          },
          backups: [
            {
              backup_id: "0192-newest",
              filename: VALID_NAME,
              created_at: "2026-06-17T08:00:00Z",
              size_bytes: 9148,
              format: "pg_dump_plain_sql",
              is_latest: true,
            },
            {
              backup_id: "0192-older",
              filename: VALID_NAME.replace("deadbeef", "beefdead"),
              created_at: "2026-06-17T07:00:00Z",
              size_bytes: 8000,
              format: "pg_dump_plain_sql",
            },
          ],
        });
      })
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.backups).toHaveLength(2);
    expect(got.status.backups?.[0].isLatest).toBe(true);
    expect(got.status.backups?.[1].isLatest).toBe(false);
    expect(got.status.latestBackup?.filename).toBe(got.status.backups?.[0].filename);
  });

  it("drops malformed entries inside backups[]", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          automation_available: true,
          next_action: "...",
          backups: [
            {
              backup_id: "valid",
              filename: VALID_NAME,
              created_at: "x",
              size_bytes: 1,
              format: "pg_dump_plain_sql",
            },
            { backup_id: "missing_filename" }, // dropped
            null, // dropped
            { filename: "no backup_id" }, // dropped
          ],
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.backups).toHaveLength(1);
    expect(got.status.backups?.[0].filename).toBe(VALID_NAME);
  });

  it("legacy response without backups[] still parses cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          automation_available: true,
          next_action: "...",
          latest_backup: {
            backup_id: "legacy",
            filename: VALID_NAME,
            created_at: "2026-06-17T08:00:00Z",
            size_bytes: 1,
            format: "pg_dump_plain_sql",
          },
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.backups).toBeUndefined();
    expect(got.status.latestBackup?.filename).toBe(VALID_NAME);
  });
});
