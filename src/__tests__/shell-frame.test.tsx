/**
 * UI-0913-C (D5, RQ-1): the shared console frame and its phone drawer.
 *
 * This project's vitest runs in node with no DOM library, so the drawer's
 * behaviour lives in shell-drawer.ts and is tested here with fakes: opening
 * locks the page and moves focus in, Escape closes, Tab and Shift+Tab stay
 * inside, closing gives the page back and returns focus to "Menu", and a tap
 * on a link closes. ShellFrame's closed markup is checked for its aria state.
 * The pointer paths (backdrop, "Close menu", link tap) and the open state in
 * a real browser are proven by export/e2e/phone-shell.spec.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isLinkTap, openDrawer, trapTab } from "../components/shared/shell-drawer";
import { SHELL_MENU_ID, ShellFrame } from "../components/shared/shell-frame";

class Stop {
  constructor(
    readonly name: string,
    private readonly env: { active: Stop | null }
  ) {}
  focus(): void {
    this.env.active = this;
  }
}

function setup(count = 3) {
  const state: { active: Stop | null } = { active: null };
  const stops = Array.from({ length: count }, (_, i) => new Stop(`stop-${i}`, state));
  const menu = new Stop("menu", state);
  state.active = menu;
  const body = { style: { overflow: "auto" } };
  const close = vi.fn();
  const drawer = openDrawer({
    stops: () => stops,
    active: () => state.active,
    menuButton: () => menu,
    body,
    close,
  });
  return { state, stops, menu, body, close, drawer };
}

function key(k: string, shiftKey = false) {
  return { key: k, shiftKey, preventDefault: vi.fn() };
}

describe("trapTab", () => {
  const items = ["a", "b", "c"];
  it("Tab from the last stop goes to the first", () => {
    expect(trapTab(items, "c", false)).toBe("a");
  });
  it("Shift+Tab from the first stop goes to the last", () => {
    expect(trapTab(items, "a", true)).toBe("c");
  });
  it("lets the browser move focus between inner stops", () => {
    expect(trapTab(items, "b", false)).toBeNull();
    expect(trapTab(items, "b", true)).toBeNull();
  });
  it("brings focus that is outside the drawer back in", () => {
    expect(trapTab(items, null, false)).toBe("a");
    expect(trapTab(items, "elsewhere", true)).toBe("c");
  });
  it("does nothing without stops", () => {
    expect(trapTab([], null, false)).toBeNull();
  });
});

describe("openDrawer", () => {
  it("opening stops the page scrolling and moves focus to the first stop", () => {
    const { state, stops, body } = setup();
    expect(body.style.overflow).toBe("hidden");
    expect(state.active).toBe(stops[0]);
  });

  it("Escape closes", () => {
    const { drawer, close } = setup();
    const e = key("Escape");
    drawer.onKey(e);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Tab and Shift+Tab stay inside the drawer", () => {
    const { drawer, state, stops } = setup();
    state.active = stops[2] ?? null;
    const tab = key("Tab");
    drawer.onKey(tab);
    expect(state.active).toBe(stops[0]);
    expect(tab.preventDefault).toHaveBeenCalled();

    const back = key("Tab", true);
    drawer.onKey(back);
    expect(state.active).toBe(stops[2]);
    expect(back.preventDefault).toHaveBeenCalled();

    state.active = stops[1] ?? null;
    const inner = key("Tab");
    drawer.onKey(inner);
    expect(state.active).toBe(stops[1]);
    expect(inner.preventDefault).not.toHaveBeenCalled();
  });

  it("other keys do nothing", () => {
    const { drawer, close, state, stops } = setup();
    const e = key("Enter");
    drawer.onKey(e);
    expect(close).not.toHaveBeenCalled();
    expect(state.active).toBe(stops[0]);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("closing gives the page its scroll back and returns focus to Menu", () => {
    const { drawer, body, state, menu } = setup();
    drawer.release();
    expect(body.style.overflow).toBe("auto");
    expect(state.active).toBe(menu);
  });
});

describe("isLinkTap", () => {
  it("is true inside a link and false elsewhere", () => {
    expect(isLinkTap({ closest: (s) => (s === "a[href]" ? {} : null) })).toBe(true);
    expect(isLinkTap({ closest: () => null })).toBe(false);
    expect(isLinkTap({})).toBe(false);
    expect(isLinkTap(null)).toBe(false);
  });
});

describe("ShellFrame markup (closed)", () => {
  const html = renderToStaticMarkup(
    <ShellFrame
      area="Organization"
      roleLabel="org_admin"
      email="admin@capture.test"
      nav={<nav data-testid="fixture-nav" />}
      navFooter={<a href="/platform-status">Platform status</a>}
      notice={<div data-testid="fixture-notice" />}
    >
      <p data-testid="fixture-page" />
    </ShellFrame>
  );

  it("has a Menu button that names the drawer and says it is closed", () => {
    const button = html.match(/<button[^>]*aria-controls="[^"]*"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain(`aria-controls="${SHELL_MENU_ID}"`);
    expect(button).toContain("md:hidden");
    expect(button).toContain("h-11");
    expect(html).toMatch(/<\/svg>Menu<\/button>/);
  });

  it("keeps the sidebar at 768 px and wider and hides it below while closed", () => {
    const aside = html.match(/<aside[^>]*>/)?.[0] ?? "";
    expect(aside).toContain(`id="${SHELL_MENU_ID}"`);
    expect(aside).toMatch(/class="[^"]*\bhidden w-60 md:flex\b/);
    expect(aside).not.toContain('role="dialog"');
    expect(aside).not.toContain("aria-modal");
    expect(html).not.toContain('data-testid="shell-backdrop"');
  });

  it("holds the menu, its footer, Close menu and Sign out once", () => {
    expect(html.match(/data-testid="fixture-nav"/g)).toHaveLength(1);
    expect(html).toContain('href="/platform-status"');
    expect(html).toMatch(/<\/svg>Close menu<\/button>/);
    expect(html).toContain('action="/api/auth/logout"');
  });

  it("shows the role, the account menu, the notice and the page with phone padding", () => {
    expect(html).toContain(">org_admin</span>");
    expect(html).toContain('data-testid="account-menu"');
    expect(html.indexOf('data-testid="fixture-notice"')).toBeLessThan(html.indexOf("<main"));
    expect(html).toMatch(/<main class="[^"]*px-4 py-4 md:px-8 md:py-8"/);
    expect(html).toContain('data-testid="fixture-page"');
  });
});
