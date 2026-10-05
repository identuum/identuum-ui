"use client";

/**
 * ProviderForm — create, edit or remove the organization's upstream OIDC
 * provider. The fields are those of docs/guides/oidc-upstream-login.md.
 *
 * SECURITY: the client secret input is type=password, autocomplete off, and
 * never pre-filled; on edit, leaving it empty keeps the stored secret.
 */

import { useActionState, useEffect, useState } from "react";
import type { OrgOidcProviderView } from "@/lib/idp-admin-client";
import {
  deleteOidcProviderAction,
  type ProviderFormState,
  saveOidcProviderAction,
} from "./actions";

const initialState: ProviderFormState = { phase: "idle" };

const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm transition-colors";

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
  const [delState, deleteAction, isDeleting] = useActionState(
    deleteOidcProviderAction,
    initialState
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [origin, setOrigin] = useState(publicBase);
  useEffect(() => {
    if (!publicBase) setOrigin(window.location.origin);
  }, [publicBase]);

  const editing = provider !== null;
  const fe = state.phase === "idle" ? (state.fieldErrors ?? {}) : {};

  if (delState.phase === "deleted") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-700">Provider removed</p>
        <p className="text-xs text-stone-600 mt-1">
          Users who signed in through it keep their accounts but can no longer sign in with it.
          Reload the page to configure a new one.
        </p>
      </div>
    );
  }

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
          After you save, this page shows the redirect URI to register with the provider (it
          contains the provider&apos;s ID).
        </p>
      )}

      <form action={formAction} className="space-y-4" autoComplete="off">
        <input type="hidden" name="mode" value={editing ? "update" : "create"} />
        <Field id="idp-name" label="Name" error={fe.name}>
          <input
            id="idp-name"
            name="name"
            defaultValue={provider?.name ?? ""}
            placeholder="Example SSO"
            className={inputClass}
          />
        </Field>
        <Field id="idp-slug" label="Short identifier" error={fe.slug}>
          <input
            id="idp-slug"
            name="slug"
            defaultValue={provider?.slug ?? ""}
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
            defaultValue={provider?.issuer_url ?? ""}
            placeholder="https://accounts.google.com"
            className={inputClass}
          />
        </Field>
        <Field id="idp-client-id" label="Client ID" error={fe.client_id}>
          <input
            id="idp-client-id"
            name="client_id"
            defaultValue={provider?.client_id ?? ""}
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
            defaultValue={(provider?.scopes.length
              ? provider.scopes
              : ["openid", "email", "profile"]
            ).join(" ")}
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
            defaultValue={provider?.email_domains.join(" ") ?? ""}
            placeholder="example.com"
            className={inputClass}
          />
        </Field>
        <label className="flex items-start gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            name="allow_external_domains"
            defaultChecked={provider?.allow_external_domains ?? false}
            className="mt-0.5"
          />
          <span>
            Allow every email domain (anyone the provider signs in gets an account in your
            organization — use with care).
          </span>
        </label>

        {state.phase === "idle" && state.error && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
        {state.phase === "saved" && (
          <p role="status" className="text-xs text-emerald-700">
            {state.message} Reload the page to see the redirect URI.
          </p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
        >
          {isPending ? "Saving…" : editing ? "Save changes" : "Save provider"}
        </button>
      </form>

      {editing && (
        <div className="border-t border-stone-100 pt-4 space-y-2">
          {confirmingDelete ? (
            <form action={deleteAction} className="space-y-2">
              <p className="text-xs text-stone-600">
                Users can no longer sign in with this provider. Remove it?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isDeleting}
                  className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 shadow-sm transition-colors"
                >
                  {isDeleting ? "Removing…" : "Remove provider"}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setConfirmingDelete(false)}
                  className={secondaryBtn}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={secondaryBtn}
            >
              Remove provider…
            </button>
          )}
          {delState.phase === "idle" && delState.error && (
            <p role="alert" className="text-xs text-red-600">
              {delState.error}
            </p>
          )}
        </div>
      )}
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
