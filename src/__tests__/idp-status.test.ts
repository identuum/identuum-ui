import { describe, expect, it } from "vitest";
import { classifyIDPStatus, hasStructuredNotLicensedSignal } from "../lib/idp-status";

describe("classifyIDPStatus", () => {
  it("maps 2xx responses to available", () => {
    expect(classifyIDPStatus(200).kind).toBe("available");
    expect(classifyIDPStatus(204).kind).toBe("available");
  });

  it("maps unavailable transport/backend statuses", () => {
    for (const status of [0, 502, 503, 504]) {
      expect(classifyIDPStatus(status), `status ${status}`).toMatchObject({
        kind: "unavailable",
        status,
      });
    }
  });

  it("maps absent endpoint statuses to feature_absent", () => {
    for (const status of [404, 501]) {
      expect(classifyIDPStatus(status), `status ${status}`).toMatchObject({
        kind: "feature_absent",
        status,
      });
    }
  });

  it("maps plain 403 to forbidden without making license claims", () => {
    expect(classifyIDPStatus(403, { error: "forbidden" })).toMatchObject({
      kind: "forbidden",
      status: 403,
    });
  });

  it("maps structured license signals to not_licensed", () => {
    const cases: unknown[] = [
      { code: "not_licensed" },
      { error: "license_required" },
      { reason: "forbidden_feature" },
      { message: "This feature is not available on your current license tier" },
    ];
    for (const body of cases) {
      expect(classifyIDPStatus(403, body).kind).toBe("not_licensed");
      expect(hasStructuredNotLicensedSignal(body)).toBe(true);
    }
  });

  it("maps 402 to not_licensed because existing UI clients already treat it as a feature gate", () => {
    expect(classifyIDPStatus(402)).toMatchObject({ kind: "not_licensed", status: 402 });
  });

  it("maps unrelated failures to unknown", () => {
    expect(classifyIDPStatus(500)).toMatchObject({ kind: "unknown", status: 500 });
  });

  it("ignores secret-like and unknown body fields", () => {
    expect(
      classifyIDPStatus(403, {
        password_hash: "redacted",
        client_secret: "redacted",
        message: "Access denied",
      })
    ).toMatchObject({ kind: "forbidden", status: 403 });
  });
});
