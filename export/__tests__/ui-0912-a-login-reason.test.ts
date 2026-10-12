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
