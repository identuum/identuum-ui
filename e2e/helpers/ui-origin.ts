import { test } from "@playwright/test";

/**
 * The Origin header a browser on the harness UI sends with a same-origin
 * request. Since v0.2.3 the UI refuses a state-changing request to
 * /api/idp/* or /api/auth/logout whose Origin is not its own ui_origin
 * (src/lib/same-origin-guard.ts), and Playwright's request API sends no
 * Origin by itself. Every harness sets ui_origin to the project's baseURL
 * origin (http://localhost:<port>), so that is the value sent here.
 */
export function uiOriginHeader(): { Origin: string } {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("uiOriginHeader: the Playwright project has no baseURL");
  return { Origin: new URL(base).origin };
}
