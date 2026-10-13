/**
 * UI-0913-SA-CARD-FIX: the service-account "Link to OAuth client" card keeps
 * its result lines (V3-027, V3-037; RELEASE-DECISION-0.9.12 defects 5 and 6).
 *
 * The card is driven through clicks and form submits. React hooks are
 * replaced by a small store keyed by component position, like React keys
 * them, so state survives re-renders and is dropped when a component leaves
 * the tree. A form submit records which action ran; the test then gives the
 * server's answer and renders again. The server actions are not called.
 * SECURITY: every value is a fixture; no secret, token or cookie appears.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: new Map<string, unknown>(),
  seen: new Set<string>(),
  path: "",
  n: 0,
  submitted: [] as string[],
}));

vi.mock("react", async (orig) => {
  const R = await orig<typeof import("react")>();
  const slot = (init: unknown) => {
    const k = `${h.path}#${h.n++}`;
    h.seen.add(k);
    if (!h.slots.has(k)) h.slots.set(k, typeof init === "function" ? init() : init);
    return k;
  };
  return {
    ...R,
    useState: (init: unknown) => {
      const k = slot(init);
      const set = (v: unknown) => h.slots.set(k, typeof v === "function" ? v(h.slots.get(k)) : v);
      return [h.slots.get(k), set];
    },
    useActionState: (_fn: unknown, init: unknown) => {
      const k = slot(init);
      return [h.slots.get(k), () => h.submitted.push(k), false];
    },
  };
});

vi.mock("@/app/org-admin/service-accounts/actions", () => ({
  linkServiceAccountToOAuthClientAction: vi.fn(),
  unlinkServiceAccountFromOAuthClientAction: vi.fn(),
}));

const { LinkToOAuthClientCard } = await import(
  "../app/org-admin/service-accounts/[id]/link-to-oauth-client-card"
);
type Props = Parameters<typeof LinkToOAuthClientCard>[0];

type Frame = {
  text: string;
  buttons: Array<{ label: string; onClick: () => void }>;
  forms: Array<(fd: FormData) => void>;
};

function walk(node: ReactNode, path: string, out: Frame): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.text += `${node} `;
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((c, i) => {
      walk(c, `${path}[${i}]`, out);
    });
    return;
  }
  if (!isValidElement(node)) return;
  const { type, props, key } = node as ReactElement<Record<string, unknown>>;
  const name = typeof type === "function" ? type.name : String(type);
  const p = `${path}/${name}${key != null ? `:${key}` : ""}`;
  if (typeof type === "function") {
    h.path = p;
    h.n = 0;
    walk((type as (q: unknown) => ReactNode)(props), p, out);
    return;
  }
  if (type === "form") out.forms.push(props.action as (fd: FormData) => void);
  const start = out.text.length;
  walk(props.children as ReactNode, p, out);
  if (type === "button" && typeof props.onClick === "function") {
    out.buttons.push({
      label: out.text.slice(start).trim(),
      onClick: props.onClick as () => void,
    });
  }
}

function frame(props: Props): Frame {
  h.seen.clear();
  const out: Frame = { text: "", buttons: [], forms: [] };
  walk(<LinkToOAuthClientCard {...props} />, "", out);
  for (const k of [...h.slots.keys()]) if (!h.seen.has(k)) h.slots.delete(k);
  return out;
}

function click(f: Frame, label: string) {
  const b = f.buttons.find((x) => x.label === label);
  if (!b) throw new Error(`no button "${label}" in: ${f.text}`);
  b.onClick();
}

function submit(f: Frame) {
  expect(f.forms).toHaveLength(1);
  f.forms[0](new FormData());
}

/** The server's answer to the last submitted form. */
function answer(state: unknown) {
  const k = h.submitted.pop();
  if (!k) throw new Error("no form was submitted");
  h.slots.set(k, state);
}

const SA = "0198b2d0-0000-7000-8000-0000000000a1";
const A = {
  id: "0198b2d0-0000-7000-8000-0000000000c1",
  client_id: "billing-batch",
  name: "Billing batch",
  is_public: false,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const B = { ...A, id: "0198b2d0-0000-7000-8000-0000000000c2", client_id: "report-sync" };
type Linked = typeof A;

const props = (linked: Linked[]): Props => ({
  serviceAccountId: SA,
  serviceAccountName: "batch-runner",
  oauthClients: [A, B].map((c) => ({ ...c, skip_consent: false })) as Props["oauthClients"],
  loadError: false,
  initialLinkedClients: linked,
  linkedClientsLoadError: false,
});
const linkOk = (c: Linked) => ({
  phase: "success",
  linked: {
    organization_id: "org-1",
    service_account_id: SA,
    oauth_client_uuid: c.id,
    oauth_client_identifier: c.client_id,
  },
});
const unlinkOk = (c: Linked) => ({
  phase: "success",
  unlinked: {
    organization_id: "org-1",
    service_account_id: SA,
    previously_linked_oauth_client_uuid: c.id,
    previously_linked_oauth_client_identifier: c.client_id,
  },
});
// The link action's words for a 404 (actions.ts, result.notFound).
const REFUSAL = "Service account or OAuth client no longer exists. Reload the page and try again.";

beforeEach(() => {
  h.slots.clear();
  h.submitted.length = 0;
});

describe("V3-027: an unlink from the linked list shows its result line", () => {
  it("keeps 'OAuth client unlinked.' after the server sends the emptied list", () => {
    let f = frame(props([A]));
    expect(f.text).toContain("Currently linked OAuth client.");
    click(f, "Unlink OAuth client");
    f = frame(props([A]));
    submit(f);
    answer(unlinkOk(A));
    // The action revalidates the page: the server now sends no linked client.
    f = frame(props([]));
    expect(f.text).toContain("OAuth client unlinked.");
    expect(f.text).toMatch(/billing-batch\s+was unlinked\./);
    expect(f.text).toContain("Link another OAuth client");
  });
});

describe("V3-037: 'Link another OAuth client' shows the next link's result", () => {
  it("shows the success line after linking a second client", () => {
    let f = frame(props([]));
    submit(f);
    answer(linkOk(A));
    f = frame(props([A]));
    expect(f.text).toContain("Service account linked to OAuth client.");
    click(f, "Unlink OAuth client");
    f = frame(props([A]));
    submit(f);
    answer(unlinkOk(A));
    f = frame(props([]));
    expect(f.text).toContain("OAuth client unlinked.");
    click(f, "Link another OAuth client");
    f = frame(props([]));
    expect(f.text).not.toContain("Service account linked to OAuth client.");
    submit(f);
    answer(linkOk(B));
    f = frame(props([B]));
    expect(f.text).toContain("Service account linked to OAuth client.");
    expect(f.text).toContain("report-sync");
  });

  it("shows the server's refusal on the second link", () => {
    let f = frame(props([A]));
    click(f, "Link another OAuth client");
    f = frame(props([A]));
    expect(f.text).not.toContain("Currently linked OAuth client.");
    submit(f);
    answer({ phase: "error", error: REFUSAL });
    f = frame(props([A]));
    expect(f.text).toContain(REFUSAL);
    expect(f.forms).toHaveLength(1);
  });
});
