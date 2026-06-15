import { type CapabilityAvailability, getCapabilityAvailability } from "./runtime-composition";
import type { ComponentCapabilities } from "./types";

export type CapabilityAffordanceState = CapabilityAvailability | "enterprise_ce_boundary";

export type CapabilityAffordanceSource = "capability_fact" | "boundary_fallback" | "unknown";

export interface CapabilityAffordance {
  factState: CapabilityAvailability;
  state: CapabilityAffordanceState;
  label: "Available" | "Unavailable" | "Unknown" | "Enterprise/CE";
  source: CapabilityAffordanceSource;
}

export type CapabilityBoundary = "enterprise_ce";

export type PrimaryNavUnavailableBehavior = "show" | "hide";

export interface PrimaryNavCapabilityDecision {
  factState: CapabilityAvailability;
  visible: boolean;
  source: CapabilityAffordanceSource;
}

interface PrimaryNavCapabilityInput {
  capabilities: ComponentCapabilities | null | undefined;
  key: keyof ComponentCapabilities;
  unavailableBehavior?: PrimaryNavUnavailableBehavior;
}

export type AuthorizationServerPageSurface =
  | "oauth_clients"
  | "api_resources"
  | "service_accounts"
  | "scope_templates"
  | "protocol_settings";

export interface AuthorizationServerPageBoundary {
  surface: AuthorizationServerPageSurface;
  title: string;
  body: string;
  source: "capability_fact";
}

interface CapabilityAffordanceInput {
  capabilities: ComponentCapabilities | null | undefined;
  key: keyof ComponentCapabilities;
  boundary?: CapabilityBoundary;
}

export function getCapabilityAffordance({
  capabilities,
  key,
  boundary,
}: CapabilityAffordanceInput): CapabilityAffordance {
  const factState = getCapabilityAvailability(capabilities ?? {}, key);

  if (factState === "available") {
    return { factState, state: "available", label: "Available", source: "capability_fact" };
  }

  if (factState === "unavailable") {
    return { factState, state: "unavailable", label: "Unavailable", source: "capability_fact" };
  }

  if (boundary === "enterprise_ce") {
    return {
      factState,
      state: "enterprise_ce_boundary",
      label: "Enterprise/CE",
      source: "boundary_fallback",
    };
  }

  return { factState, state: "unknown", label: "Unknown", source: "unknown" };
}

export function getPrimaryNavCapabilityDecision({
  capabilities,
  key,
  unavailableBehavior = "show",
}: PrimaryNavCapabilityInput): PrimaryNavCapabilityDecision {
  const factState = getCapabilityAvailability(capabilities ?? {}, key);

  if (factState === "unavailable") {
    return {
      factState,
      visible: unavailableBehavior !== "hide",
      source: "capability_fact",
    };
  }

  return {
    factState,
    visible: true,
    source: factState === "available" ? "capability_fact" : "unknown",
  };
}

const AUTHORIZATION_SERVER_PAGE_BOUNDARY_COPY: Record<
  AuthorizationServerPageSurface,
  { title: string; body: string }
> = {
  oauth_clients: {
    title: "Applications are unavailable from this backend",
    body: "Applications are an OSS/Starter Authorization Server surface when the backend exposes OAuth clients. This IDP backend reports that the OAuth client endpoint is not exposed.",
  },
  api_resources: {
    title: "API resources are unavailable from this backend",
    body: "API resources are an OSS/Starter Authorization Server surface when the backend exposes them. This IDP backend reports that the API resources endpoint is not exposed.",
  },
  service_accounts: {
    title: "Service accounts are unavailable from this backend",
    body: "Service accounts are an IDP machine-to-machine surface when the backend exposes them. This IDP backend reports that the service accounts endpoint is not exposed.",
  },
  scope_templates: {
    title: "Scope templates are unavailable from this backend",
    body: "Scope templates are an OSS/Starter Authorization Server surface when the backend exposes them. This IDP backend reports that the scope templates endpoint is not exposed.",
  },
  protocol_settings: {
    title: "Protocol settings are unavailable from this backend",
    body: "Protocol settings are an Authorization Server surface when the backend exposes them. This IDP backend reports that the protocol settings endpoint is not exposed.",
  },
};

export function getAuthorizationServerPageBoundary({
  capabilities,
  surface,
}: {
  capabilities: ComponentCapabilities | null | undefined;
  surface: AuthorizationServerPageSurface;
}): AuthorizationServerPageBoundary | null {
  if (getCapabilityAvailability(capabilities ?? {}, surface) !== "unavailable") {
    return null;
  }

  return {
    surface,
    source: "capability_fact",
    ...AUTHORIZATION_SERVER_PAGE_BOUNDARY_COPY[surface],
  };
}
