/**
 * The OSS binary's own recorded GET answers (fixtures/oss-org-admin-answers.json)
 * as harness routes, and a one-call page renderer over them.
 */
import recorded from "./fixtures/oss-org-admin-answers.json";
import { installExport, type Routes } from "./harness";

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

export function heading(html: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<h1[^>]*>${escaped}</h1>`).test(html);
}
