/** UI-G9 T2/T7 and M1-M4: real claim/action/MFA components, mocked fetch.
 * Position-keyed hooks follow ui-0914-mustchange.test.tsx. No DOM, Next server,
 * browser, backend, credential or timing proof is claimed. The form library
 * supplies a fixture code; QR/provisioning/recovery values are not recorded.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsumeClaimState } from "../app/claim/actions";
import { ClaimFormClient } from "../app/claim/form-client";

const h = vi.hoisted(() => ({
  slots: new Map<string, unknown>(),
  path: "",
  n: 0,
  effects: [] as Array<() => unknown>,
  push: vi.fn(),
  refresh: vi.fn(),
  mutateAnswer: null as null | ((state: unknown) => unknown),
}));

vi.mock("react", async (original) => {
  const R = await original<typeof import("react")>();
  function slot(initial: unknown) {
    const key = `${h.path}#${h.n++}`;
    if (!h.slots.has(key)) h.slots.set(key, initial);
    return key;
  }
  return {
    ...R,
    useState: (initial: unknown) => {
      const key = slot(initial);
      return [h.slots.get(key), (value: unknown) => h.slots.set(key, value)];
    },
    useRef: (initial: unknown) => h.slots.get(slot({ current: initial })),
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const key = slot(undefined);
      const previous = h.slots.get(key) as unknown[] | undefined;
      if (!previous || deps.some((dep, i) => dep !== previous[i])) {
        h.slots.set(key, deps);
        h.effects.push(effect);
      }
    },
    useActionState: (
      action: (previous: unknown, fd: FormData) => Promise<unknown>,
      initial: unknown
    ) => {
      const key = slot(initial);
      return [
        h.slots.get(key),
        async (fd: FormData) => {
          const state = await action(h.slots.get(key), fd);
          h.slots.set(key, h.mutateAnswer ? h.mutateAnswer(state) : state);
        },
        false,
      ];
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "https://idp.test",
}));
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit: (submit: (data: { code: string }) => Promise<void>) => () =>
      submit({ code: "000000" }),
    formState: { errors: {}, isSubmitting: false },
  }),
}));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null }));

type Props = Parameters<typeof ClaimFormClient>[0];
type NodeProps = Record<string, unknown>;
type Frame = {
  text: string;
  forms: NodeProps[];
  inputs: NodeProps[];
  links: Array<{ text: string; href: unknown }>;
  buttons: Array<{ text: string; click: () => unknown }>;
};
const props: Props = {
  rawToken: "claim-fixture",
  targetEmail: "",
  organizationName: "Claim organization",
  emailBound: false,
};

function walk(node: ReactNode, path: string, out: Frame): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.text += String(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      walk(child, `${path}[${i}]`, out);
    });
    return;
  }
  if (!isValidElement(node)) return;
  const { type, props: p, key } = node as ReactElement<NodeProps>;
  const position = `${path}/${typeof type === "function" ? type.name : String(type)}:${key ?? ""}`;
  if (typeof type === "function") {
    h.path = position;
    h.n = 0;
    walk((type as (p: NodeProps) => ReactNode)(p), position, out);
    return;
  }
  // Input is a real forwardRef component. No ref/DOM behavior is exercised.
  if (typeof type === "object" && type && "render" in type) {
    walk(
      (type as unknown as { render: (p: NodeProps, ref: null) => ReactNode }).render(p, null),
      position,
      out
    );
    return;
  }
  if (type === "code" || type === "textarea") return;
  if (type === "form") out.forms.push(p);
  if (type === "input") out.inputs.push(p);
  const start = out.text.length;
  walk(p.children as ReactNode, position, out);
  const text = out.text.slice(start).replace(/\s+/g, " ").trim();
  if (type === "a") out.links.push({ text, href: p.href });
  if (type === "button" && typeof p.onClick === "function")
    out.buttons.push({ text, click: p.onClick as () => unknown });
  if (["div", "p", "h2", "h3", "label", "button", "form"].includes(String(type))) out.text += " ";
}

function frame(overrides: Partial<Props> = {}): Frame {
  const out: Frame = { text: "", forms: [], inputs: [], links: [], buttons: [] };
  walk(<ClaimFormClient {...props} {...overrides} />, "", out);
  out.text = out.text.replace(/\s+/g, " ").trim();
  for (const effect of h.effects.splice(0)) effect();
  return out;
}

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function submitClaim() {
  const f = frame();
  expect(f.forms).toHaveLength(1);
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    token: "claim-fixture",
    email: "admin@example.test",
    password: "fixture-password",
    confirmPassword: "fixture-password",
    name: "",
  }))
    fd.set(key, value);
  await (f.forms[0].action as (fd: FormData) => Promise<unknown>)(fd);
  return frame();
}

function noSetupForm(f: Frame) {
  expect(f.forms).toHaveLength(0);
  expect(f.inputs.some((input) => input.name === "password" || input.name === "email")).toBe(false);
  expect(f.text).not.toContain("Set up two-factor authentication");
}

function signIn(f: Frame) {
  expect(f.links).toContainEqual({ text: "Go to sign in", href: "/login" });
}

function neutralTerminal(f: Frame) {
  expect(f.text).toBe(
    "Setup link no longer valid This setup link is invalid, expired, or has already been used. Please contact your administrator for a new link. Go to sign in"
  );
  noSetupForm(f);
  signIn(f);
}

async function enrolledForm(recovery = false) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(reply({ success: true }))
    .mockResolvedValueOnce(reply({ mfa_required: true, session_id: "pending-fixture" }))
    .mockResolvedValueOnce(
      reply({
        secret: "fixture",
        otpauth_url: "fixture",
        recovery_codes: recovery ? ["fixture"] : [],
      })
    );
  vi.stubGlobal("fetch", fetchMock);
  const loading = await submitClaim();
  expect(loading.text).toContain("Account created");
  expect(loading.text).toContain("Setting up two-factor authentication…");
  // Drain settled mocked promises; no wall-clock wait or network polling.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const f = frame();
  expect(f.text).toContain("Set up two-factor authentication");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  return { f, fetchMock };
}

beforeEach(() => {
  h.slots.clear();
  h.effects.length = 0;
  h.push.mockReset();
  h.refresh.mockReset();
  h.mutateAnswer = null;
  vi.stubGlobal("window", { location: { href: "" } });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unconfigured test request")));
});
afterEach(() => vi.unstubAllGlobals());

describe("T2/T7: real action outcomes rendered by the real claim form", () => {
  it.each([false, true])("C1 is terminal and neutral, diagnostics=%s", async (diagnostics) => {
    const body = diagnostics
      ? {
          success: false,
          error: "email_exists",
          reason: "held_address",
          message: "Account already exists",
          holder: "holder@example.test",
        }
      : { success: false };
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(body));
    vi.stubGlobal("fetch", fetchMock);
    const f = await submitClaim();
    neutralTerminal(f);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("C3 shows the exact exhausted copy without a retry or MFA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        reply({
          success: false,
          attempts_exhausted: true,
          message:
            "Maximum password attempts reached. Please contact your administrator for a new claim link.",
        })
      )
    );
    const f = await submitClaim();
    expect(f.text).toBe(
      "Setup link expired Maximum password attempts reached. Please contact your administrator for a new claim link. Contact your administrator to request a new setup link. Go to sign in"
    );
    noSetupForm(f);
    signIn(f);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([2, 1, 0])("C2 remaining %i keeps the form and current counter", async (n) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        reply({
          success: false,
          attempts_remaining: n,
          message: "Password does not meet the required strength.",
        })
      )
    );
    const f = await submitClaim();
    expect(f.forms).toHaveLength(1);
    expect(f.text).toContain("Password does not meet the required strength.");
    if (n)
      expect(f.text).toContain(
        `${n} attempt${n === 1 ? "" : "s"} remaining before this link is permanently invalidated.`
      );
    else expect(f.text).not.toContain("remaining before");
    expect(f.text).not.toContain("Setup link expired");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["409 email_exists", "network", "invalid JSON"])(
    "%s keeps neutral form copy",
    async (fault) => {
      const fetchMock = vi.fn();
      if (fault === "network") fetchMock.mockRejectedValueOnce(new Error("email_exists"));
      else if (fault === "invalid JSON")
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError("email_exists");
          },
        });
      else
        fetchMock.mockResolvedValueOnce(
          reply({ error: "email_exists", message: "Account already exists" }, 409)
        );
      vi.stubGlobal("fetch", fetchMock);
      const f = await submitClaim();
      expect(f.forms).toHaveLength(1);
      expect(f.text).toContain(
        fault.startsWith("409")
          ? "Setup failed. Please try again or request a new link."
          : "Network error. Please check your connection and try again."
      );
      expect(f.text).not.toMatch(/email_exists|Account already exists|Account created/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("P2 shows success with sign-in to finish MFA, never a completed enrollment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ success: true }))
      .mockResolvedValueOnce(reply({ error: "account_unverified" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const f = await submitClaim();
    expect(f.text).toContain("Account set up successfully");
    expect(f.text).toContain(
      "Sign in to finish — two-factor authentication setup will start automatically."
    );
    expect(f.links).toContainEqual({ text: "Sign in →", href: "/login" });
    noSetupForm(f);
    expect(f.text).not.toContain("account_unverified");
    expect(f.text).not.toContain("You are signed in.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe("M1-M4: shared MFA continuation inside the claim page", () => {
  it("Back goes to sign-in with the MFA-setup reason", async () => {
    const { f } = await enrolledForm();
    f.buttons.find((b) => b.text === "Back to sign in")!.click();
    expect(window.location.href).toBe("/login?reason=mfa_setup_required");
    expect(h.push).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "completion waits for recovery acknowledgement when present=%s",
    async (recovery) => {
      const { f, fetchMock } = await enrolledForm(recovery);
      fetchMock.mockResolvedValueOnce(reply({ role: "org_admin" }));
      await (f.forms[0].onSubmit as () => Promise<void>)();
      let done = frame();
      if (recovery) {
        expect(done.text).toContain("Save your recovery codes");
        expect(done.text).not.toContain("Setup complete —");
        expect(h.push).not.toHaveBeenCalled();
        done.buttons.find((b) => b.text === "I've saved my recovery codes")!.click();
        done = frame();
      }
      expect(done.text).toContain("Setup complete — two-factor authentication enrolled");
      expect(done.text).toContain(
        "Your org_admin account for Claim organization is now fully operational. You are signed in."
      );
      expect(done.text).not.toContain("Save your recovery codes");
      noSetupForm(done);
      done.buttons.find((b) => b.text === "Continue to org admin →")!.click();
      expect(h.push).toHaveBeenCalledExactlyOnceWith("/org-admin");
      expect(h.refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    }
  );

  it.each([400, 401, 403, 429, 500, "network", "invalid JSON"])(
    "initiate %s shows the same expired-session screen",
    async (fault) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reply({ success: true }))
        .mockResolvedValueOnce(reply({ mfa_required: true, session_id: "pending-fixture" }));
      if (fault === "network") fetchMock.mockRejectedValueOnce(new Error("internal diagnostic"));
      else if (fault === "invalid JSON")
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError("internal diagnostic");
          },
        });
      else fetchMock.mockResolvedValueOnce(reply({ error: "invalid_request" }, fault as number));
      vi.stubGlobal("fetch", fetchMock);
      await submitClaim();
      await new Promise<void>((resolve) => setImmediate(resolve));
      const f = frame();
      expect(f.text).toContain("Setup session expired. Please sign in again.");
      expect(f.links).toContainEqual({ text: "sign in again", href: "/login" });
      expect(f.forms).toHaveLength(0);
      expect(f.text).not.toMatch(/invalid_request|internal diagnostic/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }
  );

  it.each([
    { label: "400 invalid_request", status: 400, error: "invalid_request" },
    { label: "401 invalid_code", status: 401, error: "invalid_code" },
    { label: "403 csrf_failed", status: 403, error: "csrf_failed" },
    { label: "429 login_throttled", status: 429, error: "login_throttled" },
    { label: "500 internal_error", status: 500, error: "internal_error" },
    { label: "network", status: 0, error: "" },
    { label: "invalid JSON", status: 200, error: "" },
  ])(
    "complete $label retains the form with the current wrong-code banner",
    async ({ status, error }) => {
      const { f, fetchMock } = await enrolledForm();
      if (status === 0) fetchMock.mockRejectedValueOnce(new Error("internal diagnostic"));
      else if (status === 200)
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError("internal diagnostic");
          },
        });
      else fetchMock.mockResolvedValueOnce(reply({ error }, status));
      await (f.forms[0].onSubmit as () => Promise<void>)();
      const next = frame();
      expect(next.text).toContain("Invalid verification code. Try again.");
      expect(next.forms).toHaveLength(1);
      expect(next.text).not.toContain("Setup complete —");
      expect(window.location.href).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(4);
    }
  );

  it.each(["session invalid", "session not found"])(
    "legacy %s redirects instead of showing the wrong-code banner",
    async (error) => {
      const { f, fetchMock } = await enrolledForm();
      fetchMock.mockResolvedValueOnce(reply({ error }, 401));
      await (f.forms[0].onSubmit as () => Promise<void>)();
      expect(window.location.href).toBe("/login?reason=session_expired");
      expect(frame().text).not.toContain("Invalid verification code. Try again.");
    }
  );
});

describe("negative controls for the neutral terminal oracle", () => {
  // Simulate mutations at the action-result boundary entirely in test memory.
  // These are oracle checks, not evidence of a real account-existence leak or
  // product-source mutation runs. Both use the same oracle as C1 above.
  it.each(["diagnostic copy", "retry form"])("rejects simulated %s", async (mutation) => {
    h.mutateAnswer = (state) => ({
      ...(state as ConsumeClaimState),
      ...(mutation === "diagnostic copy" ? { error: "Account already exists" } : { phase: "form" }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ success: false })));
    const f = await submitClaim();
    expect(() => neutralTerminal(f)).toThrow();
  });
});
