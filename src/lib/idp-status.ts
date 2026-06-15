/**
 * Pure UI-side classification for observable IDP API outcomes.
 *
 * This helper does not discover backend capabilities. It only maps status
 * codes and explicit structured error signals into stable UI states so pages
 * can distinguish "backend down" from "feature absent" from "permission
 * denied" without hardcoding deployment assumptions.
 */

export type IDPStatusKind =
  | "available"
  | "unavailable"
  | "feature_absent"
  | "forbidden"
  | "not_licensed"
  | "unknown";

export interface IDPStatusClassification {
  kind: IDPStatusKind;
  status: number;
}

const NOT_LICENSED_CODES = new Set(["not_licensed", "license_required", "forbidden_feature"]);

function stringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function hasStructuredNotLicensedSignal(body: unknown): boolean {
  const code =
    stringField(body, "code") ?? stringField(body, "error") ?? stringField(body, "reason");
  if (code && NOT_LICENSED_CODES.has(code.toLowerCase())) return true;

  const message = stringField(body, "message");
  return Boolean(
    message &&
      /license tier|current license|not available on your current license|not included in your current license/i.test(
        message
      )
  );
}

export function classifyIDPStatus(status: number, body?: unknown): IDPStatusClassification {
  if (status >= 200 && status < 300) return { kind: "available", status };
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return { kind: "unavailable", status };
  }
  if (status === 404 || status === 501) return { kind: "feature_absent", status };
  if (status === 402) return { kind: "not_licensed", status };
  if (status === 403) {
    return {
      kind: hasStructuredNotLicensedSignal(body) ? "not_licensed" : "forbidden",
      status,
    };
  }
  return { kind: "unknown", status };
}
