/**
 * UI-0914-MUSTCHANGE-CONSOLE: a passkey sign-in meets the password change an
 * administrator asked for (D-017) or an expired administrator-set password
 * (G2), as password sign-in does (identuum-idp-oss 92936bf):
 *
 *   passkey finish  POST /api/v1/auth/login/webauthn/finish
 *                   → 401 {error:"password_change_required", password_change_required:true, session_id}
 *                   → 401 {error:"password_expired", message}
 *
 * The sign-in is driven through the real passkey button. React hooks are
 * replaced by a small store keyed by component position (as in
 * ui-0913-sa-card.test.tsx), the form library by a stub that has the email,
 * and the change step by a stub that shows which handle it was given.
 * SECURITY: every value is a fixture; no token, cookie or credential appears.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: new Map<string, unknown>(),
  seen: new Set<string>(),
  path: "",
  n: 0,
}));

vi.mock("react", async (orig) => {
  const R = await orig<typeof import("react")>();
  return {
    ...R,
    useState: (init: unknown) => {
      const k = `${h.path}#${h.n++}`;
      h.seen.add(k);
      if (!h.slots.has(k)) h.slots.set(k, typeof init === "function" ? init() : init);
      const set = (v: unknown) => h.slots.set(k, typeof v === "function" ? v(h.slots.get(k)) : v);
      return [h.slots.get(k), set];
    },
    // Effects run at once; the state they set shows on the next frame.
    useEffect: (fn: () => undefined | (() => void)) => {
      fn();
    },
  };
});

const EMAIL = "member@acme.example";
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit: (fn: unknown) => fn,
    getValues: () => EMAIL,
    trigger: async () => true,
    formState: { errors: {}, isSubmitting: false },
  }),
}));

vi.mock("../components/auth/password-change-form", () => ({
  PasswordChangeForm: ({ sessionId }: { sessionId: string }) => (
    <p>{`password change step for ${sessionId}`}</p>
  ),
}));
vi.mock("../components/auth/mfa-form", () => ({
  MFAForm: ({ sessionId }: { sessionId: string }) => <p>{`code step for ${sessionId}`}</p>,
}));

const { LoginFlow } = await import("../components/auth/login-flow");

type Frame = { text: string; buttons: Array<{ label: string; onClick: () => unknown }> };

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
  const start = out.text.length;
  walk(props.children as ReactNode, p, out);
  if (type === "button" && typeof props.onClick === "function") {
    out.buttons.push({
      label: out.text.slice(start).trim(),
      onClick: props.onClick as () => unknown,
    });
  }
}

function frame(): Frame {
  h.seen.clear();
  const out: Frame = { text: "", buttons: [] };
  walk(<LoginFlow onSuccess={() => {}} />, "", out);
  for (const k of [...h.slots.keys()]) if (!h.seen.has(k)) h.slots.delete(k);
  return out;
}

const BEGIN = "/api/idp/api/v1/auth/login/webauthn/begin";
const FINISH = "/api/idp/api/v1/auth/login/webauthn/finish";
const HANDLE = "0198b2d0-0000-7000-8000-0000000000ef";

/** Signs in with the passkey; the finish step answers `status` and `body`. */
async function passkeySignIn(status: number, body: unknown): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === BEGIN) {
        return new Response(
          JSON.stringify({
            publicKey: { challenge: "AAAA", allowCredentials: [] },
            session_id: "begin-fixture",
          }),
          { status: 200 }
        );
      }
      if (url.startsWith(`${FINISH}?`)) return new Response(JSON.stringify(body), { status });
      return new Response("{}", { status: 404 });
    })
  );
  const buf = new Uint8Array([1, 2, 3]).buffer;
  vi.stubGlobal("navigator", {
    credentials: {
      get: async () => ({
        id: "cred-fixture",
        rawId: buf,
        type: "public-key",
        response: { clientDataJSON: buf, authenticatorData: buf, signature: buf, userHandle: null },
      }),
    },
  });
  frame();
  const f = frame();
  const button = f.buttons.find((b) => b.label === "Sign in with passkey");
  if (!button) throw new Error(`no passkey button in: ${f.text}`);
  await button.onClick();
  return frame().text;
}

beforeEach(() => {
  h.slots.clear();
  vi.stubGlobal("window", { PublicKeyCredential: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("passkey sign-in and the password an administrator set", () => {
  it("password_change_required leads to the change step with the handle", async () => {
    const text = await passkeySignIn(401, {
      error: "password_change_required",
      password_change_required: true,
      session_id: HANDLE,
    });
    expect(text).toContain(`password change step for ${HANDLE}`);
    expect(text).not.toContain("Passkey sign-in failed");
  });

  it("password_expired shows the words password sign-in shows", async () => {
    const text = await passkeySignIn(401, {
      error: "password_expired",
      message: "This password has expired. Ask your administrator for a new reset link.",
    });
    expect(text).toContain(
      "This password has expired. Ask your administrator for a new reset link."
    );
    expect(text).not.toContain("Passkey sign-in failed");
  });

  it("an unknown refusal keeps today's words", async () => {
    const text = await passkeySignIn(401, { error: "something_new" });
    expect(text).toContain("Passkey sign-in failed. Try again or use your password.");
  });

  it("a change answer without a handle keeps today's words", async () => {
    const text = await passkeySignIn(401, {
      error: "password_change_required",
      password_change_required: true,
    });
    expect(text).toContain("Passkey sign-in failed. Try again or use your password.");
    expect(text).not.toContain("password change step");
  });

  it("mfa_required still leads to the code step", async () => {
    const text = await passkeySignIn(401, {
      error: "mfa_required",
      mfa_required: true,
      session_id: "m",
    });
    expect(text).toContain("code step for m");
  });
});

describe("the provider sign-in refusals OSS added in v0.9.14", () => {
  it.each([
    [
      "password_change_required",
      "Sign in with the password your administrator gave you and choose a new one.",
    ],
    ["password_expired", "This password has expired. Ask your administrator for a new reset link."],
  ])("%s", async (code, words) => {
    const { upstreamRefusalText } = await import("../lib/sign-in-refusals");
    expect(upstreamRefusalText(code)).toBe(words);
  });
});
