/**
 * Unit tests for the backup-automation helpers added to
 * `src/lib/idp-upgrade-client.ts` in the Phase 10 backup automation
 * foundation slice.
 *
 * Mocks global fetch. Each test pins one discriminated-union variant
 * of `getBackupStatus` / `createBackup` so the /upgrade wizard can
 * rely on narrow result shapes when rendering branch-specific UI.
 *
 * No localStorage / sessionStorage / document.cookie writes are
 * exercised here — those are pinned by the wider source-invariant
 * test file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, getBackupStatus } from "../lib/idp-upgrade-client";

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

describe("getBackupStatus", () => {
  it("projects automation_available=true with no prior backup", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        expect(url).toBe("/api/idp/api/upgrade/backup");
        return jsonResponse(200, {
          automation_available: true,
          backup_directory: "/app/data/backups/upgrade",
          next_action: 'Click "Create backup" ...',
        });
      })
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.automationAvailable).toBe(true);
    expect(got.status.backupDirectory).toBe("/app/data/backups/upgrade");
    expect(got.status.latestBackup).toBeUndefined();
    expect(got.status.nextAction).toMatch(/Create backup/);
  });

  it("projects automation_available=true with latest_backup metadata", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          automation_available: true,
          backup_directory: "/app/data/backups/upgrade",
          latest_backup: {
            backup_id: "01234567-89ab-7def-8000-abc",
            filename: "identuum-idp-ce-upgrade-backup-20260617T120000Z-deadbeef.sql",
            created_at: "2026-06-17T12:00:00Z",
            size_bytes: 12345,
            format: "pg_dump_plain_sql",
          },
          next_action: "A local backup is ready.",
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.latestBackup?.filename).toContain("identuum-idp-ce-upgrade-backup-");
    expect(got.status.latestBackup?.sizeBytes).toBe(12345);
    expect(got.status.latestBackup?.format).toBe("pg_dump_plain_sql");
  });

  it("projects automation_available=false with a known reason", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          automation_available: false,
          reason: "pg_dump_unavailable",
          next_action: "Local backup automation is not available...",
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.automationAvailable).toBe(false);
    expect(got.status.reason).toBe("pg_dump_unavailable");
  });

  it("drops unknown reason values", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          automation_available: false,
          reason: "definitely_not_a_known_code",
          next_action: "Confirm an external backup.",
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.reason).toBeUndefined();
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const got = await getBackupStatus();
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on non-OK HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("", { status: 500 }))
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(500);
  });

  it("returns error on malformed JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("not json", { status: 200 }))
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("error");
  });

  it("returns error when automation_available is missing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          next_action: "no flag here",
        })
      )
    );
    const got = await getBackupStatus();
    expect(got.kind).toBe("error");
  });
});

describe("createBackup", () => {
  it("returns ok+result on a 200 success body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) => {
        expect(url).toBe("/api/idp/api/upgrade/backup");
        expect(init?.method).toBe("POST");
        return jsonResponse(200, {
          backup_id: "01234567-89ab-7def-8000-abc",
          filename: "identuum-idp-ce-upgrade-backup-20260617T120000Z-deadbeef.sql",
          created_at: "2026-06-17T12:00:00Z",
          size_bytes: 9876,
          format: "pg_dump_plain_sql",
          backup_directory: "/app/data/backups/upgrade",
          next_action: "A local backup is ready.",
        });
      })
    );
    const got = await createBackup();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.result.backupId).toBe("01234567-89ab-7def-8000-abc");
    expect(got.result.filename).toMatch(/identuum-idp-ce-upgrade-backup-/);
    expect(got.result.sizeBytes).toBe(9876);
    expect(got.result.format).toBe("pg_dump_plain_sql");
    expect(got.result.backupDirectory).toBe("/app/data/backups/upgrade");
  });

  it("maps backup_automation_unavailable to a rejected outcome", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(503, {
          error: "backup_automation_unavailable",
          reason: "pg_dump_unavailable",
          next_action: "Local backup automation is not available...",
        })
      )
    );
    const got = await createBackup();
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("backup_automation_unavailable");
    expect(got.reason).toBe("pg_dump_unavailable");
    expect(got.message).toMatch(/not available/);
  });

  it("maps database_unreachable to a rejected outcome", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(503, {
          error: "database_unreachable",
          next_action: "Cannot reach the configured database from pg_dump.",
        })
      )
    );
    const got = await createBackup();
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("database_unreachable");
    expect(got.reason).toBeUndefined();
  });

  it("maps backup_failed to a rejected outcome", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(500, {
          error: "backup_failed",
          next_action: "Backup creation failed.",
        })
      )
    );
    const got = await createBackup();
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("backup_failed");
  });

  it("returns error when the server gives an unrecognised error code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(500, {
          error: "totally_new_code",
          next_action: "n/a",
        })
      )
    );
    const got = await createBackup();
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(500);
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    const got = await createBackup();
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on malformed success body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("not json", { status: 200 }))
    );
    const got = await createBackup();
    expect(got.kind).toBe("error");
  });

  it("posts to the same-origin proxy with JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        backup_id: "id",
        filename: "f",
        created_at: "",
        size_bytes: 0,
        format: "",
        backup_directory: "",
        next_action: "",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await createBackup();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/idp/api/upgrade/backup",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: "{}",
      })
    );
  });
});
