/**
 * Browser-driven regression coverage for the OSS-to-CE upgrade wizard
 * backup affordance (Phase 10 backup automation foundation + the
 * 2026-06-17 retention/pruning slice).
 *
 * Scope:
 *   - /upgrade renders the Database backup section when the backend
 *     reports an upgrade-required state AND backup automation is
 *     available.
 *   - The "Create backup" button POSTs to the same-origin proxy
 *     /api/idp/api/upgrade/backup; the new entry appears in the
 *     list with safe metadata only.
 *   - The two-step Remove → Confirm destructive flow: first click
 *     exposes the confirmation controls; Cancel backs out WITHOUT
 *     issuing the destructive POST; Confirm calls
 *     /api/idp/api/upgrade/backup/prune exactly once.
 *   - A successful prune removes the targeted entry from the visible
 *     list and preserves the others.
 *   - A backup_not_found rejection shows safe operator-friendly copy
 *     and never leaks backup contents into the page.
 *
 * Backend fixture strategy:
 *   page.addInitScript() patches window.fetch BEFORE React hydration
 *   so every /api/idp/api/upgrade/* call from the wizard hits an
 *   in-page mock that maintains a small backup-list state. This is
 *   the same proven pattern used by e2e/login.spec.ts — page.route()
 *   is unreliable with Next.js dev server's keep-alive connections.
 *
 *   The mock returns JSON shapes faithful to the CE backend wire
 *   contract documented in internal/upgrade/backup.go +
 *   cmd/identuum-idp/upgrade_handlers.go. The wizard's discriminated-
 *   union helpers (src/lib/idp-upgrade-client.ts) parse the
 *   responses; if either side drifts these tests catch it.
 *
 *   No real CE backend, no `pg_dump`, no real backup file, no
 *   /tmp scratch — pure browser-level mocks. The Next.js server-side
 *   initial getUpgradeStatus() call in /upgrade page.tsx is allowed
 *   to fail through naturally (no IDP listening) so `initial=null`;
 *   the wizard then re-fetches on mount through the mocked fetch and
 *   drives the visible state from there.
 *
 * SECURITY:
 *   - Backup contents are never injected into the mock body — only
 *     safe metadata (filename, size_bytes, created_at, format).
 *   - The filenames used as mock fixtures match the
 *     server-side product-managed pattern, but carry no real
 *     timestamp/hex meaning beyond passing the client-side guard.
 *   - The mocked responses never include DB URLs, passwords,
 *     upgrade-token plaintext, license envelopes, or any other
 *     secret material.
 *   - No localStorage / sessionStorage / document.cookie writes
 *     are exercised by the test fixture (and the wizard itself is
 *     source-invariant-asserted to not touch them either — see
 *     src/__tests__/upgrade-wizard-backup-prune-source-invariants.test.ts).
 */

import { expect, test } from "@playwright/test";

// ── Constants ────────────────────────────────────────────────────────────────

// Two pre-seeded product-managed filenames. The trailing 8-hex
// segment + 14-char timestamp + .sql suffix match the strict
// server-side `backupFilenameRE` so the wizard's client-side
// `isProductBackupFilename` guard accepts them.
const PRESEEDED_NEWEST = "identuum-idp-ce-upgrade-backup-20260617T080500Z-aaaaaaaa.sql";
const PRESEEDED_OLDER = "identuum-idp-ce-upgrade-backup-20260617T080000Z-bbbbbbbb.sql";

// One more filename used in the not-found rejection test. The
// pattern must validate client-side (otherwise the helper
// short-circuits to backup_filename_invalid without a network call
// and the test would not exercise the wire-code response path).
const NOT_FOUND_FILENAME = "identuum-idp-ce-upgrade-backup-20260617T079999Z-cccccccc.sql";

// Mock backup body size used in created entries. The wizard renders
// this with toLocaleString() so the assertion is on a substring.
const MOCK_SIZE_BYTES = 38897;

// ── Mock fetch installer ─────────────────────────────────────────────────────
//
// Serialised as a string so TypeScript does not type-check the
// browser-context code. The mock keeps a small array of backup
// entries on `window.__idpBackupState` so each test can inspect what
// was created/pruned, and so list/create/prune flows mutate a
// shared backing store. The store starts pre-seeded with two
// entries so the list renders even before the first Create click.
//
// The mock returns nothing for non-upgrade endpoints — `_orig(input, init)`
// passes them through to the real Next.js dev server so unrelated
// requests (favicon, /api/health, etc.) keep working.

interface MockBackupEntry {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}

interface MockInstallOptions {
  preseededBackups: MockBackupEntry[];
  /** When non-empty, a prune request for this filename returns 404 backup_not_found. */
  pruneNotFoundFilename?: string;
}

function installMockScript(opts: MockInstallOptions): string {
  return `
    (function() {
      var origFetch = window.fetch.bind(window);
      var state = {
        // Newest-first list seed. Mutated by the mock as the test
        // exercises create + prune.
        backups: ${JSON.stringify(opts.preseededBackups)},
        // Counters so the test can assert exactly-once semantics on
        // the destructive endpoints.
        callCount: { create: 0, prune: 0 },
        // Capture every prune body so the spec can assert the
        // request payload shape (filename only, no path separators).
        pruneBodies: [],
      };
      window.__idpBackupState = state;
      var notFoundFilename = ${JSON.stringify(opts.pruneNotFoundFilename || "")};

      function jsonResponse(status, body) {
        return new Response(JSON.stringify(body), {
          status: status,
          headers: { "Content-Type": "application/json" },
        });
      }

      function buildAvailability() {
        var hasAny = state.backups.length > 0;
        var newest = hasAny ? state.backups[0] : null;
        var metadataList = state.backups.map(function (b, i) {
          return {
            backup_id: "mock-" + i + "-" + b.filename,
            filename: b.filename,
            created_at: b.createdAt,
            size_bytes: b.sizeBytes,
            format: "pg_dump_plain_sql",
            is_latest: i === 0,
          };
        });
        return {
          automation_available: true,
          backup_directory: "/app/data/backups/upgrade",
          latest_backup: newest
            ? {
                backup_id: "mock-latest-" + newest.filename,
                filename: newest.filename,
                created_at: newest.createdAt,
                size_bytes: newest.sizeBytes,
                format: "pg_dump_plain_sql",
                is_latest: true,
              }
            : undefined,
          backups: metadataList,
          next_action: hasAny
            ? "A local backup is ready. You can create another, or continue with the upgrade after confirming the backup."
            : "Click \\"Create backup\\" to write a pg_dump backup of the current database to the appliance data volume before applying the upgrade.",
        };
      }

      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url ? input.url : "";
        var method = ((init && init.method) || "GET").toUpperCase();

        // /api/upgrade/status — return an upgrade-required state so
        // the wizard renders the Database backup section.
        if (url.indexOf("/api/idp/api/upgrade/status") !== -1) {
          return Promise.resolve(
            jsonResponse(200, {
              state: "oss_database_detected",
              product: "identuum-idp-ce",
              distribution: "ce",
              upgrade_available: true,
              ce_migrations_current: false,
              oss_database_detected: true,
              backup_required: true,
              next_action:
                "Existing OSS deployment detected. Confirm a database backup before starting the upgrade.",
              applied_version: "0000",
              target_version: "0022",
              pending_count: 22,
            })
          );
        }

        // /api/upgrade/preflight — return ready=true with safe checks.
        if (url.indexOf("/api/idp/api/upgrade/preflight") !== -1 && method === "POST") {
          return Promise.resolve(
            jsonResponse(200, {
              state: "oss_database_detected",
              ready: false,
              backup_confirmed: false,
              backup_required: true,
              checks: [
                { id: "database_reachable", ok: true, label: "Database reachable" },
                { id: "users_orgs_preserved", ok: true, label: "Existing users and organizations preserved" },
                { id: "oauth_clients_compatible", ok: true, label: "OAuth clients compatible" },
                { id: "sessions_preserved", ok: true, label: "Existing sessions preserved" },
                { id: "signing_keys_imported", ok: true, label: "Signing keys imported safely" },
                { id: "backup_confirmed", ok: false, label: "Database backup confirmed" },
              ],
              next_action: "Confirm a database backup before applying the upgrade.",
            })
          );
        }

        // /api/upgrade/backup/prune (POST) — must match BEFORE the
        // bare /api/upgrade/backup match below, otherwise the prune
        // path would be misrouted to the create handler.
        if (url.indexOf("/api/idp/api/upgrade/backup/prune") !== -1 && method === "POST") {
          state.callCount.prune += 1;
          var pruneBody = init && init.body ? String(init.body) : "";
          state.pruneBodies.push(pruneBody);
          var parsed;
          try {
            parsed = JSON.parse(pruneBody);
          } catch (_e) {
            return Promise.resolve(
              jsonResponse(400, {
                error: "invalid_request",
                next_action: "The prune request body must be {\\"filename\\": \\"...\\"}.",
              })
            );
          }
          var fn = parsed && typeof parsed.filename === "string" ? parsed.filename : "";
          if (fn === "") {
            return Promise.resolve(
              jsonResponse(400, {
                error: "filename_required",
                next_action: "The prune request must name a backup file to delete.",
              })
            );
          }
          if (notFoundFilename !== "" && fn === notFoundFilename) {
            return Promise.resolve(
              jsonResponse(404, {
                error: "backup_not_found",
                next_action: "No backup with that filename exists. Refresh the backup list and retry.",
              })
            );
          }
          // Remove the named file from the backing store; preserve
          // the others. Idempotent within the test fixture — a
          // second prune of the same filename converges to 404
          // through the same code path because the entry is gone.
          var before = state.backups.length;
          state.backups = state.backups.filter(function (b) {
            return b.filename !== fn;
          });
          if (state.backups.length === before) {
            return Promise.resolve(
              jsonResponse(404, {
                error: "backup_not_found",
                next_action: "No backup with that filename exists. Refresh the backup list and retry.",
              })
            );
          }
          return Promise.resolve(
            jsonResponse(200, {
              filename: fn,
              backup_directory: "/app/data/backups/upgrade",
              next_action:
                "Backup deleted. Remaining backups stay available; restore is still an operator action using psql against the chosen file.",
            })
          );
        }

        // /api/upgrade/backup (GET) — newest-first list + latest.
        if (url.indexOf("/api/idp/api/upgrade/backup") !== -1 && method === "GET") {
          return Promise.resolve(jsonResponse(200, buildAvailability()));
        }

        // /api/upgrade/backup (POST) — mint a new entry. The created
        // timestamp is monotonically newer than every existing entry
        // so the new file lands at index 0.
        if (url.indexOf("/api/idp/api/upgrade/backup") !== -1 && method === "POST") {
          state.callCount.create += 1;
          var idx = state.backups.length;
          // Synthesise a filename that matches the strict server
          // pattern. The hex suffix uses zero-padded index so each
          // call yields a distinct filename within the test.
          var hex = "00000000".slice(String(idx).length) + String(idx);
          var ts = "20260617T080" + (5 + idx) + "00Z"; // 6-digit HHMMSS portion bumped per create
          // The strict server pattern requires \\d{6} after T. Pad
          // explicitly to avoid edge cases when idx grows beyond 4.
          var hhmmss = "08" + ("0" + idx).slice(-2) + "00";
          var filename =
            "identuum-idp-ce-upgrade-backup-20260617T" + hhmmss + "Z-c000000" + (idx % 10) + ".sql";
          var newEntry = {
            filename: filename,
            createdAt: "2026-06-17T" + hhmmss.slice(0, 2) + ":" + hhmmss.slice(2, 4) + ":" + hhmmss.slice(4, 6) + "Z",
            sizeBytes: ${MOCK_SIZE_BYTES},
          };
          // newest-first
          state.backups = [newEntry].concat(state.backups);
          return Promise.resolve(
            jsonResponse(200, {
              backup_id: "mock-create-" + idx,
              filename: newEntry.filename,
              created_at: newEntry.createdAt,
              size_bytes: newEntry.sizeBytes,
              format: "pg_dump_plain_sql",
              backup_directory: "/app/data/backups/upgrade",
              next_action:
                "A local backup is ready. You can create another, or continue with the upgrade after confirming the backup.",
            })
          );
        }

        return origFetch(input, init);
      };
    })();
  `;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("/upgrade — backup affordance", () => {
  test("renders the Database backup section with the pre-seeded newest-first list", async ({
    page,
  }) => {
    await page.addInitScript(
      installMockScript({
        preseededBackups: [
          {
            filename: PRESEEDED_NEWEST,
            createdAt: "2026-06-17T08:05:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
          {
            filename: PRESEEDED_OLDER,
            createdAt: "2026-06-17T08:00:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
        ],
      })
    );
    await page.goto("/upgrade");

    // The wizard polls /api/upgrade/status on mount; the Database
    // backup section then renders. data-testid pins keep these
    // assertions stable against copy churn.
    await expect(page.getByTestId("upgrade-wizard")).toBeVisible();
    await expect(page.getByTestId("upgrade-backup-automation-card")).toBeVisible();
    await expect(page.getByTestId("upgrade-backup-create")).toBeVisible();

    // Both pre-seeded backups appear as list rows. The newest one is
    // tagged with the "latest" badge; the order is newest-first.
    const newestRow = page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_NEWEST}`);
    const olderRow = page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_OLDER}`);
    await expect(newestRow).toBeVisible();
    await expect(olderRow).toBeVisible();
    await expect(newestRow).toContainText("latest");
    await expect(olderRow).not.toContainText("latest");

    // Safe metadata only: filename, byte count (toLocaleString
    // adds a comma), and the ISO timestamp must be visible. The
    // SQL body bytes must never appear in the rendered page.
    await expect(newestRow).toContainText(PRESEEDED_NEWEST);
    await expect(newestRow).toContainText("38,897 bytes");
    await expect(newestRow).toContainText("2026-06-17T08:05:00Z");
    const html = await page.content();
    expect(html).not.toContain("PostgreSQL database dump");
    expect(html).not.toContain("-- pg_dump");
  });

  test("Create backup adds an entry through the same-origin proxy and refreshes the list", async ({
    page,
  }) => {
    await page.addInitScript(
      installMockScript({
        preseededBackups: [
          {
            filename: PRESEEDED_OLDER,
            createdAt: "2026-06-17T08:00:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
        ],
      })
    );
    await page.goto("/upgrade");

    await expect(page.getByTestId("upgrade-backup-create")).toBeVisible();
    await expect(page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_OLDER}`)).toBeVisible();

    await page.getByTestId("upgrade-backup-create").click();

    // Success card surfaces the just-created filename.
    await expect(page.getByTestId("upgrade-backup-create-ok")).toBeVisible({ timeout: 5_000 });

    // The list has grown to 2 entries. The new entry sits at index 0
    // (newest-first) and carries the "latest" badge; the old one
    // loses the badge.
    const oldRow = page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_OLDER}`);
    await expect(oldRow).toBeVisible();
    await expect(oldRow).not.toContainText("latest");

    // The in-page mock recorded exactly one Create call and the
    // backing store grew by 1 entry. The mock is the source of
    // truth for "the network request happened" because
    // page.waitForRequest() does not see addInitScript-patched
    // fetch calls (they short-circuit before reaching Playwright's
    // network layer).
    const state = await page.evaluate(
      () =>
        (
          window as unknown as {
            __idpBackupState: {
              callCount: { create: number };
              backups: { filename: string }[];
            };
          }
        ).__idpBackupState
    );
    expect(state.callCount.create).toBe(1);
    expect(state.backups.length).toBe(2);
    // The pre-seeded older backup is still present after the new
    // create — the create endpoint is additive, never replaces an
    // existing entry.
    expect(state.backups.some((b) => b.filename === PRESEEDED_OLDER)).toBe(true);
  });

  test("Remove → Cancel does NOT call /backup/prune; Remove → Confirm calls it exactly once and removes only the targeted entry", async ({
    page,
  }) => {
    await page.addInitScript(
      installMockScript({
        preseededBackups: [
          {
            filename: PRESEEDED_NEWEST,
            createdAt: "2026-06-17T08:05:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
          {
            filename: PRESEEDED_OLDER,
            createdAt: "2026-06-17T08:00:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
        ],
      })
    );
    await page.goto("/upgrade");

    const newestRow = page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_NEWEST}`);
    const olderRow = page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_OLDER}`);
    await expect(newestRow).toBeVisible();
    await expect(olderRow).toBeVisible();

    // ── Step 1: click Remove on the OLDER backup. ─────────────────
    //
    // The first click flips the row into pending-confirm. The
    // confirm/cancel pair appears; the destructive prune POST must
    // NOT fire yet.
    await page.getByTestId(`upgrade-backup-prune-request-${PRESEEDED_OLDER}`).click();

    await expect(page.getByTestId(`upgrade-backup-prune-confirm-${PRESEEDED_OLDER}`)).toBeVisible();
    await expect(page.getByTestId(`upgrade-backup-prune-cancel-${PRESEEDED_OLDER}`)).toBeVisible();

    // No prune calls yet.
    let pruneCalls = await page.evaluate(
      () =>
        (window as unknown as { __idpBackupState: { callCount: { prune: number } } })
          .__idpBackupState.callCount.prune
    );
    expect(pruneCalls).toBe(0);

    // ── Step 2: click Cancel. ─────────────────────────────────────
    //
    // The row returns to the idle Remove button. Still no prune
    // call. Other rows are untouched. Both backups remain in the
    // list.
    await page.getByTestId(`upgrade-backup-prune-cancel-${PRESEEDED_OLDER}`).click();
    await expect(page.getByTestId(`upgrade-backup-prune-request-${PRESEEDED_OLDER}`)).toBeVisible();
    pruneCalls = await page.evaluate(
      () =>
        (window as unknown as { __idpBackupState: { callCount: { prune: number } } })
          .__idpBackupState.callCount.prune
    );
    expect(pruneCalls).toBe(0);
    await expect(newestRow).toBeVisible();
    await expect(olderRow).toBeVisible();

    // ── Step 3: click Remove again, then Confirm. ─────────────────
    //
    // The Confirm click fires POST /api/idp/api/upgrade/backup/prune
    // exactly once with {filename: PRESEEDED_OLDER}. The older row
    // disappears; the newer row stays and is now the only "latest".
    // The in-page mock captures every prune body so the spec can
    // assert the request payload shape — page.waitForRequest()
    // does NOT see addInitScript-patched fetch calls.
    await page.getByTestId(`upgrade-backup-prune-request-${PRESEEDED_OLDER}`).click();
    await page.getByTestId(`upgrade-backup-prune-confirm-${PRESEEDED_OLDER}`).click();

    // OK banner surfaces the just-deleted filename.
    await expect(page.getByTestId("upgrade-backup-prune-ok")).toContainText(PRESEEDED_OLDER);

    // The older row disappears; the newer one survives.
    await expect(olderRow).toHaveCount(0);
    await expect(newestRow).toBeVisible();

    // Inspect the captured request: exactly one prune call recorded,
    // body is `{"filename": "<PRESEEDED_OLDER>"}` with no path
    // separators / `..` / DSN material.
    const finalState = await page.evaluate(
      () =>
        (
          window as unknown as {
            __idpBackupState: {
              callCount: { prune: number };
              pruneBodies: string[];
              backups: { filename: string }[];
            };
          }
        ).__idpBackupState
    );
    expect(finalState.callCount.prune).toBe(1);
    expect(finalState.pruneBodies).toHaveLength(1);
    const parsed = JSON.parse(finalState.pruneBodies[0]) as { filename?: string };
    expect(parsed.filename).toBe(PRESEEDED_OLDER);
    // The body must NOT contain path separators or relative
    // components — the wizard always sends the bare filename.
    expect(finalState.pruneBodies[0]).not.toContain("/");
    expect(finalState.pruneBodies[0]).not.toContain("\\");
    expect(finalState.pruneBodies[0]).not.toContain("..");
    // The mock's backing store now contains exactly the newer
    // backup — the older one was removed; nothing else was touched.
    expect(finalState.backups.map((b) => b.filename)).toEqual([PRESEEDED_NEWEST]);

    // No backup content leaked anywhere in the page.
    const html = await page.content();
    expect(html).not.toContain("PostgreSQL database dump");
    expect(html).not.toContain("-- pg_dump");
  });

  test("backup_not_found rejection surfaces safe operator copy and does not leak content", async ({
    page,
  }) => {
    await page.addInitScript(
      installMockScript({
        preseededBackups: [
          // Pre-seed an entry that exists so the list renders.
          // The Remove flow will be driven on this entry; the mock
          // is configured to return backup_not_found for it
          // (simulating a race where another operator pruned it
          // between the list fetch and the Confirm click).
          {
            filename: NOT_FOUND_FILENAME,
            createdAt: "2026-06-17T07:59:59Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
          {
            filename: PRESEEDED_NEWEST,
            createdAt: "2026-06-17T08:05:00Z",
            sizeBytes: MOCK_SIZE_BYTES,
          },
        ],
        pruneNotFoundFilename: NOT_FOUND_FILENAME,
      })
    );
    await page.goto("/upgrade");

    const missingRow = page.getByTestId(`upgrade-backup-list-row-${NOT_FOUND_FILENAME}`);
    await expect(missingRow).toBeVisible();

    // Drive the destructive flow on the missing entry.
    await page.getByTestId(`upgrade-backup-prune-request-${NOT_FOUND_FILENAME}`).click();
    await page.getByTestId(`upgrade-backup-prune-confirm-${NOT_FOUND_FILENAME}`).click();

    // Safe error copy is rendered. The backend's `next_action`
    // is shown verbatim — no SQL fragments, no DB URL, no
    // backup body.
    const errBanner = page.getByTestId("upgrade-backup-prune-error");
    await expect(errBanner).toBeVisible();
    await expect(errBanner).toContainText(/refresh the backup list/i);

    // No leak markers in the rendered HTML.
    const html = await page.content();
    expect(html).not.toContain("PostgreSQL database dump");
    expect(html).not.toContain("postgres://");
    expect(html).not.toContain("PGPASSWORD");

    // The list is unchanged (the mock did NOT remove the entry on a
    // 404 path), so both rows still appear.
    await expect(missingRow).toBeVisible();
    await expect(page.getByTestId(`upgrade-backup-list-row-${PRESEEDED_NEWEST}`)).toBeVisible();
  });
});
