// target: src/__tests__/ui-0913-a-screens.test.tsx (append; kept apart so its mocks stay small)
/**
 * UI-0913-A D10 U7 red-first (prep). A provider save refused by the IdP with a
 * reason that starts with a proper noun keeps its capital. At 5577201
 * saveRefused (sign-in-providers/actions.ts:63-68) lowers any /^[A-Z][a-z]+\b/.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));

describe("U7: proper nouns keep their capital", () => {
  it("'Google rejected …' is not lowered", async () => {
    // proposed: export saveRefused (private at 5577201) or test through the action.
    const mod = (await import("../app/org-admin/settings/sign-in-providers/provider-words")) as {
      saveRefused?: (s: number, r: string) => string;
    };
    expect(typeof mod.saveRefused).toBe("function");
    expect(mod.saveRefused?.(400, "Google rejected the client id.")).toBe(
      "The provider was not saved: Google rejected the client id."
    );
  });
});
