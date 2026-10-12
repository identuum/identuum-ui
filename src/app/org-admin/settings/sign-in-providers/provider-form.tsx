"use client";

/**
 * ProviderForm — add or edit the organization's upstream OIDC provider. The
 * fields are those of docs/guides/oidc-upstream-login.md. A save returns to
 * the Settings card, which shows the result once (UI-0912-B); Remove is on
 * that card.
 *
 * SECURITY: the client secret input is type=password, autocomplete off, and
 * never pre-filled; on edit, leaving it empty keeps the stored secret.
 */

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { OrgOidcProviderView } from "@/lib/idp-admin-client";
import { type ProviderFormState, saveOidcProviderAction } from "./actions";
import { rememberProviderResult, SIGN_IN_PROVIDERS_HREF, sessionStore } from "./result-flash";

const initialState: ProviderFormState = { phase: "idle" };

const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-stone-50 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60";

/** The callback to register with the provider (the guide's "Redirect URI"). */
export function providerCallbackUrl(base: string, providerId: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/auth/idp/${encodeURIComponent(providerId)}/callback`;
}

export function ProviderForm({
  provider,
  publicBase,
}: {
  provider: OrgOidcProviderView | null;
  publicBase: string;
}) {
  const [state, formAction, isPending] = useActionState(saveOidcProviderAction, initialState);
  const router = useRouter();
  const [origin, setOrigin] = useState(publicBase);
  useEffect(() => {
    if (!publicBase) setOrigin(window.location.origin);
  }, [publicBase]);
  // Saved: back to Settings, which shows "Provider saved." or "Provider
  // updated." once, with the redirect URI in the provider's row.
  useEffect(() => {
    if (state.phase !== "saved") return;
    const store = sessionStore();
    if (store) rememberProviderResult(store, state.result);
    router.push(SIGN_IN_PROVIDERS_HREF);
  }, [state, router]);

  const editing = provider !== null;
  const fe = state.phase === "idle" ? (state.fieldErrors ?? {}) : {};
  // React resets this form after every submission. A failed save hands back
  // what was typed (never the client secret) and the reset restores it.
  const typed = state.phase === "idle" ? state.values : undefined;

  return (
    <div className="space-y-5">
      {editing && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-sky-950">
            Redirect URI to register with the provider
          </p>
          <p className="text-xs font-mono text-stone-700 break-all" data-testid="provider-callback">
            {origin ? providerCallbackUrl(origin, provider.id) : ""}
          </p>
          <p className="text-[11px] text-stone-400">
            Status: {provider.active ? "active" : "inactive"} · Slug{" "}
            <span className="font-mono">{provider.slug}</span>
          </p>
        </div>
      )}
      {!editing && (
        <p className="text-xs text-stone-500">
          After you save, the redirect URI appears in the list on the Settings page.
        </p>
      )}

      <form action={formAction} className="space-y-4" autoComplete="off">
        <input type="hidden" name="mode" value={editing ? "update" : "create"} />
        {state.phase === "idle" && state.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {state.error}
          </p>
        )}
        <Field id="idp-name" label="Name" error={fe.name}>
          <input
            id="idp-name"
            name="name"
            defaultValue={typed?.name ?? provider?.name ?? ""}
            placeholder="Example SSO"
            className={inputClass}
          />
        </Field>
        <Field id="idp-slug" label="Short identifier" error={fe.slug}>
          <input
            id="idp-slug"
            name="slug"
            defaultValue={typed?.slug ?? provider?.slug ?? ""}
            placeholder="example-sso"
            className={inputClass}
          />
        </Field>
        <Field
          id="idp-issuer"
          label="Issuer URL"
          error={fe.issuer_url}
          help="The provider's issuer; its discovery document is read from {issuer}/.well-known/openid-configuration. Google: https://accounts.google.com. Microsoft Entra ID: https://login.microsoftonline.com/{tenant}/v2.0."
        >
          <input
            id="idp-issuer"
            name="issuer_url"
            type="url"
            defaultValue={typed?.issuer_url ?? provider?.issuer_url ?? ""}
            placeholder="https://accounts.google.com"
            className={inputClass}
          />
        </Field>
        <Field id="idp-client-id" label="Client ID" error={fe.client_id}>
          <input
            id="idp-client-id"
            name="client_id"
            defaultValue={typed?.client_id ?? provider?.client_id ?? ""}
            className={inputClass}
          />
        </Field>
        <Field
          id="idp-client-secret"
          label="Client secret"
          error={fe.client_secret}
          help={
            editing
              ? "Leave empty to keep the stored secret. It is stored encrypted and never shown again."
              : "Stored encrypted and never shown again."
          }
        >
          <input
            id="idp-client-secret"
            name="client_secret"
            type="password"
            autoComplete="new-password"
            defaultValue=""
            className={inputClass}
          />
        </Field>
        <Field
          id="idp-scopes"
          label="Scopes"
          help="openid is always sent; email and profile give the email and name."
        >
          <input
            id="idp-scopes"
            name="scopes"
            defaultValue={
              typed?.scopes ??
              (provider?.scopes.length ? provider.scopes : ["openid", "email", "profile"]).join(" ")
            }
            className={inputClass}
          />
        </Field>
        <Field
          id="idp-domains"
          label="Email domains"
          error={fe.email_domains}
          help="A first-time user is created only when the provider has verified their email and its domain is listed here (separate with spaces or commas)."
        >
          <input
            id="idp-domains"
            name="email_domains"
            defaultValue={typed?.email_domains ?? provider?.email_domains.join(" ") ?? ""}
            placeholder="example.com"
            className={inputClass}
          />
        </Field>
        <label className="flex items-start gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            name="allow_external_domains"
            defaultChecked={
              typed?.allow_external_domains ?? provider?.allow_external_domains ?? false
            }
            className="mt-0.5"
          />
          <span>
            Allow every email domain (anyone the provider signs in gets an account in your
            organization — use with care).
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isPending || state.phase === "saved"}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            {isPending ? "Saving…" : editing ? "Save changes" : "Save provider"}
          </button>
          <a href={SIGN_IN_PROVIDERS_HREF} className={secondaryBtn}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  help,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-sky-950">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {help && <p className="text-xs text-stone-400">{help}</p>}
    </div>
  );
}
