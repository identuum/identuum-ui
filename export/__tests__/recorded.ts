/**
 * The OSS binary's own recorded GET answers (fixtures/oss-org-admin-answers.json
 * as an org_admin, fixtures/oss-site-admin-answers.json as the site
 * administrator) as harness routes, and one-call page renderers over them.
 */
import recorded from "./fixtures/oss-org-admin-answers.json";
import siteRecorded from "./fixtures/oss-site-admin-answers.json";
import { installExport, type Routes, session } from "./harness";

export const answers = recorded.answers as Routes;
export const APP = recorded.paths.app;
export const API = recorded.paths.api;
export const SA = recorded.paths.sa;
export const idOf = (p: string) => p.split("/").pop() ?? "";
export const ORG = (answers["GET /api/v1/organizations/current"] as { json: { id: string } }).json
  .id;

export async function page(path: string, extra: Routes = {}) {
  const env = installExport(path, { ...answers, ...extra });
  const out = await env.render();
  return { ...out, env };
}

export const siteAnswers = siteRecorded.answers as Routes;
/** The recorded tenant the site administrator's pages were visited with. */
export const SITE_ORG = idOf(siteRecorded.paths.org ?? "");
export const SITE_ADMIN_SESSION = { json: session("site_admin") };

/** A site-admin page as the site administrator, over the recorded answers. */
export async function sitePage(path: string, extra: Routes = {}) {
  const env = installExport(path, {
    ...siteAnswers,
    "GET /api/v1/validate": SITE_ADMIN_SESSION,
    ...extra,
  });
  const out = await env.render();
  return { ...out, env };
}

export function heading(html: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<h1[^>]*>${escaped}</h1>`).test(html);
}
