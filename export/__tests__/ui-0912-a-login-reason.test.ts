import { describe, expect, it } from "vitest";
import { addressWithoutReason } from "../src/login-route";

// UI-0912-A, part A3 (OSS v0.9.12 C6): the sign-in reason banner shows once.
// After its first render the reason leaves the address bar, so a reload or a
// bookmark does not show "You have been signed out." again; every other
// parameter stays.
describe("the sign-in reason leaves the address bar after it is shown", () => {
  it.each([
    ["?reason=signed_out", "/login"],
    ["?reason=session_expired&next=%2Fdashboard", "/login?next=%2Fdashboard"],
    ["?next=%2Fdashboard&reason=signed_out&org=acme", "/login?next=%2Fdashboard&org=acme"],
  ])("%s becomes %s", (search, expected) => {
    expect(addressWithoutReason("/login", search)).toBe(expected);
  });

  it.each(["", "?next=%2Fdashboard"])("%s has no reason and is left alone", (search) => {
    expect(addressWithoutReason("/login", search)).toBeNull();
  });
});

// UI-0912-AB-FIX F7 (judge ruling): only the signed-out banner shows once.
// "Sign-out could not be confirmed" (Retry sign-out), "signed out on this
// device only" and "session expired" stay until they are resolved. The
// browser half (address bar, reload, submit) is export/e2e/login-reason.spec.ts.
describe("which sign-in banners show once", () => {
  it("signed_out does; every other reason does not", async () => {
    const { showsOnce } = await import("../src/login-route");
    expect(showsOnce("signed_out")).toBe(true);
    for (const reason of ["sign_out_unconfirmed", "signed_out_locally", "session_expired", null]) {
      expect(showsOnce(reason)).toBe(false);
    }
  });
});
