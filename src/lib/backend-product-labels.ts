/**
 * Derives the display label for a backend product from its /health response body.
 *
 * Each backend reports its identity differently:
 *
 *   identuum-ag-oss:    {"product":"identuum-ag-oss","status":"ok"}
 *   identuum-idp (CE):  {"status":"healthy","version":"…","product":"identuum-idp-ce","…"}
 *   identuum-idp (oss): {"status":"healthy","version":"…","mode":"oss","tier":"starter"}
 *   identuum-idp (monolith): {"status":"healthy","version":"…","product":"identuum-idp","…"}
 *   identuum-ag (monolith):  {"surface":"management","ok":true}  — no product/mode field
 *
 * Priority:
 *   1. `product` field when present and non-empty (AG OSS, IDP monolith, IDP CE)
 *   2. `mode` field when present ("oss" or "ce") (IDP OSS)
 *   3. Static fallback per domain (legacy AG monolith and any unknown shape)
 */

export type BackendDomain = "idp" | "ag";

const FALLBACK: Record<BackendDomain, string> = {
  idp: "identuum-idp",
  ag: "identuum-ag",
};

export function deriveProductLabel(domain: BackendDomain, body: unknown): string {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const raw = body as Record<string, unknown>;

    // Priority 1: explicit product field (AG OSS, IDP monolith, IDP CE).
    if (typeof raw.product === "string" && raw.product.length > 0) {
      return raw.product;
    }

    // Priority 2: mode field without product (IDP OSS).
    if (raw.mode === "oss") return `identuum-${domain}-oss`;
    if (raw.mode === "ce") return `identuum-${domain}-ce`;
  }

  // Priority 3: static fallback for AG monolith and unknown shapes.
  return FALLBACK[domain];
}
