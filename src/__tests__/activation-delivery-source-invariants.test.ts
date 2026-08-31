/**
 * activation-delivery-source-invariants.test.ts — ACTIVATION-DELIVERY-1
 *
 * THE-UNUSABLE-TOKEN (2026-08-31). Two decisions this slice made, pinned so
 * they cannot silently rot:
 *
 *   (a) THE LINK IS THE PRIMARY AFFORDANCE. The org-create success panel
 *       renders the activation URL the server returns, and — when the server
 *       could not build one — the server's reason. The raw token stays
 *       copyable with its one-time warning. A bare token is not a usable
 *       credential: /activate consumes ?token from the query string and
 *       offers no input field.
 *
 *   (b) NO "AIR-GAPPED" FRAMING for an unconfigured-email state. Air-gapped
 *       is a CE feature and OSS has no such concept at all (measured: zero
 *       symbols, and the health payload carries no is_air_gapped). OSS runs
 *       in BOTH email-configured and email-not-configured modes, so calling
 *       one of them "air-gapped" asserts a deployment topology nobody
 *       established — the lying-message class.
 *
 * Source-invariant style (no process spawn, no network, no browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/** Files that carry the operator-facing activation-delivery flow. */
const FLOW_FILES = [
  "src/app/site-admin/organizations/new/form-client.tsx",
  "src/app/site-admin/organizations/new/actions.ts",
  "src/lib/idp-admin-client.ts",
  "src/app/org-admin/users/[id]/approve-button.tsx",
  "src/components/shared/setup-link-panel.tsx",
];

describe("the activation hand-off stays usable and honestly named [ACTIVATION-DELIVERY-1]", () => {
  it("the success panel renders the server's link AND its unavailable reason [ACTIVATION-DELIVERY-1]", () => {
    const form = read("src/app/site-admin/organizations/new/form-client.tsx");
    expect(form, "renders the activation URL").toContain("activationUrl");
    expect(form, "renders the server's reason when no link exists").toContain(
      "activationUrlUnavailable"
    );
    // The link must be an actual anchor the operator can open/copy, not
    // prose about a link.
    expect(form, "the link is an anchor bound to the URL").toMatch(/href=\{activationUrl\}/);
    // The raw token stays available, with its one-time warning intact.
    expect(form, "the raw token is still shown for copying").toContain("{activationToken}");
    expect(form, "the one-time warning survives").toMatch(/will not be shown again/i);
  });

  it("the client carries the server's two mutually exclusive fields, never a synthesized URL", () => {
    const client = read("src/lib/idp-admin-client.ts");
    expect(client, "reads activation_url from the server").toContain("data.activation_url");
    expect(client, "reads the unavailable reason from the server").toContain(
      "data.activation_url_unavailable"
    );
    // The action layer must forward both, so the panel can branch.
    const actions = read("src/app/site-admin/organizations/new/actions.ts");
    expect(actions).toContain("activationUrl");
    expect(actions).toContain("activationUrlUnavailable");
  });

  it("no activation-flow file calls an unconfigured-email state air-gapped", () => {
    // A corrective note that RECORDS the removed misnomer is allowed — it is
    // the explanation, not the claim. Those notes are multi-line comments, so
    // the exemption is judged over the surrounding CONTEXT, not one line:
    // a mention is fine only when its neighbourhood says the concept does not
    // apply here. A fresh "air-gapped mode: ..." banner has no such
    // neighbourhood and still fails.
    const EXEMPT = /DO NOT EXIST|does not exist|not OSS|CE feature|editions that issue one/i;
    const offenders: string[] = [];
    for (const file of FLOW_FILES) {
      const lines = read(file).split("\n");
      for (const [i, line] of lines.entries()) {
        if (!/air[\s-]?gap/i.test(line)) continue;
        const context = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
        if (EXEMPT.test(context)) continue;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders, `air-gapped framing survives in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("approve-success is gated on the shape the server actually returns", () => {
    const client = read("src/lib/idp-admin-client.ts");
    // MEASURED: idp-oss HandleApproveUser returns the bare safe-user object.
    // Gating on a `success` flag it never sends reported failure on success.
    expect(client, "success is the returned user's id, not a phantom flag").toMatch(
      /res\.ok && typeof data\?\.id === "string"/
    );
  });
});
