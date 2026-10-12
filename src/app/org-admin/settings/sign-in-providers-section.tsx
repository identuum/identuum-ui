"use client";

/**
 * The Settings card "Sign-in providers" (UI-0912-B, OSS v0.9.12 C5).
 *
 * Lists the organization's sign-in providers with what an administrator needs
 * to see: name, type, short identifier, status, email domains, last update and
 * the redirect URI to register with the provider. Add and Edit open their own
 * pages and come back here with one result line; Remove asks first and happens
 * in place. The sign-in policy is shown in words, read-only (owner Q7 a).
 *
 * Both editions serve ONE provider per organization (the singular
 * /api/v1/organizations/:id/identity-provider route), so "Add provider" is
 * disabled, with the reason written next to it, once one exists (owner Q9 a).
 * The list keeps its 0..n shape for a later edition that serves more.
 *
 * SECURITY (pinned by Vitest): the card reads only the operator-safe fields
 * of its wire helper; it never renders a client secret, a key or a token.
 */

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { LocalTime } from "@/components/ui/local-time";
import type {
  ListOrganizationIdentityProvidersResult,
  OrgIdentityProviderItem,
} from "@/lib/idp-admin-client";
import { deleteOidcProviderAction, type ProviderFormState } from "./sign-in-providers/actions";
import { providerCallbackUrl } from "./sign-in-providers/provider-form";
import { sessionStore, takeProviderResult } from "./sign-in-providers/result-flash";

const NEW_HREF = "/org-admin/settings/sign-in-providers/new";
const editHref = (id: string) =>
  `/org-admin/settings/sign-in-providers/${encodeURIComponent(id)}/edit`;

const idle: ProviderFormState = { phase: "idle" };

const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600 disabled:shadow-none";
const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-stone-50 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 disabled:opacity-60";
const dangerBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:opacity-60";

/** The sign-in policy in words (COPY B-02..B-04, B-06). */
export function policyLine(authPolicy: string | null): string {
  if (authPolicy === "local_only") return "Members sign in with: password only.";
  if (authPolicy === "mixed") return "Members sign in with: password or a sign-in provider.";
  if (authPolicy === "idp_only") return "Members sign in with: a sign-in provider only.";
  return "The sign-in policy could not be read.";
}

/**
 * The hint, only when the policy and the list disagree (COPY B-05, B-05b).
 * Measured at identuum-idp-oss 16e01c5: PUT /api/v1/organizations/:id lets the
 * organization's own org_admin change auth_policy and refuses a site_admin
 * (403 forbidden_field), so B-05 names the organization administrator.
 */
export function policyHint(authPolicy: string | null, count: number): string | null {
  if (authPolicy === "local_only" && count > 0) {
    return "The sign-in page will not offer this provider until the policy allows it. An organization administrator can change the policy.";
  }
  if (authPolicy === "idp_only" && count === 0) {
    return "No provider is set up, so members cannot sign in with one yet. Add a provider.";
  }
  return null;
}

function typeLabel(type: string): string {
  return type === "oidc" || type === "" ? "OpenID Connect" : type;
}

function domainsLabel(p: OrgIdentityProviderItem): string {
  if (p.allow_external_domains) return "Any domain";
  return p.email_domains.length > 0 ? p.email_domains.join(", ") : "—";
}

export function SignInProvidersSection({
  result,
  authPolicy,
  publicBase,
  initialResult = null,
}: {
  result: ListOrganizationIdentityProvidersResult;
  authPolicy: string | null;
  publicBase: string;
  /** A result line to show at first render (tests; the page passes none). */
  initialResult?: string | null;
}) {
  const [delState, deleteAction, isDeleting] = useActionState(deleteOidcProviderAction, idle);
  const [saved, setSaved] = useState<string | null>(initialResult);
  const [origin, setOrigin] = useState(publicBase);
  const [removing, setRemoving] = useState<OrgIdentityProviderItem | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const limitId = useId();

  useEffect(() => {
    if (!publicBase) setOrigin(window.location.origin);
  }, [publicBase]);

  // The Add or Edit page that saved left one word for this card: show its
  // line once, and bring the card into view.
  useEffect(() => {
    const store = sessionStore();
    const line = store ? takeProviderResult(store) : null;
    if (line) setSaved(line);
    if (line || window.location.hash === "#sign-in-providers") {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, []);

  // A removal finished: close the dialog and move focus to the result line,
  // because the Remove… button it came from may be gone.
  useEffect(() => {
    if (delState.phase === "deleted" || (delState.phase === "idle" && delState.error)) {
      setRemoving(null);
      statusRef.current?.focus();
    }
  }, [delState]);

  const providers = result.ok ? result.identity_providers : [];
  const removed = delState.phase === "deleted";
  const removeError = delState.phase === "idle" ? delState.error : undefined;
  const status = removed ? "Provider removed." : saved;
  const hint = result.ok ? policyHint(authPolicy, providers.length) : null;
  const atLimit = providers.length >= 1;

  const cancelRemove = () => {
    setRemoving(null);
    removeTrigger.current?.focus();
  };

  const copy = (id: string, url: string) => {
    const done = () => setCopied(id);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => undefined);
    }
  };

  return (
    // wrap-anywhere: a narrow window (the shell's fixed sidebar leaves a phone
    // very little room, RQ-1) wraps long words instead of cutting them off.
    <section
      id="sign-in-providers"
      ref={sectionRef}
      aria-labelledby={headingId}
      className="scroll-mt-6 wrap-anywhere bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id={headingId} className="text-sm font-semibold text-sky-950">
          Sign-in providers
        </h2>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
          Let members sign in with an outside account, such as Google or Microsoft Entra ID.
        </p>
      </div>

      <div className="px-6 py-4 space-y-3">
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className={
            status
              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              : "sr-only"
          }
        >
          {status ?? ""}
        </p>
        {removeError && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {removeError}
          </p>
        )}

        <p className="text-sm text-sky-950">{policyLine(authPolicy)}</p>
        {hint && <p className="text-xs text-amber-800 leading-relaxed">{hint}</p>}

        {!result.ok && (
          <p role="alert" className="text-sm text-red-700">
            {result.forbidden
              ? "You do not have permission to see sign-in providers."
              : result.featureUnavailable
                ? "This server does not offer sign-in providers."
                : "The sign-in providers could not be read. Try again in a moment."}
          </p>
        )}

        {result.ok && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {atLimit ? (
              <button type="button" disabled aria-describedby={limitId} className={primaryBtn}>
                Add provider
              </button>
            ) : (
              <a href={NEW_HREF} className={primaryBtn}>
                Add provider
              </a>
            )}
            {atLimit && (
              <p id={limitId} className="text-xs text-stone-600">
                This edition supports one sign-in provider.
              </p>
            )}
          </div>
        )}

        {result.ok && providers.length === 0 && (
          <p className="text-xs text-stone-500 leading-relaxed">
            No sign-in provider yet. Members sign in with a password.
          </p>
        )}
      </div>

      {result.ok && providers.length > 0 && (
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {providers.map((p, i) => {
            const url = origin ? providerCallbackUrl(origin, p.id) : "";
            return (
              <li key={p.id} className="px-6 py-4 space-y-3">
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <dt className="text-xs font-medium text-stone-500 sm:pt-0.5">Name</dt>
                  <dd className="font-semibold text-sky-950 break-words">{p.name}</dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Type
                  </dt>
                  <dd className="text-stone-800">{typeLabel(p.type)}</dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Short identifier
                  </dt>
                  <dd className="font-mono text-stone-800 break-all">{p.slug}</dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Status
                  </dt>
                  <dd className={p.active ? "text-emerald-700" : "text-stone-600"}>
                    {p.active ? "Active" : "Inactive"}
                  </dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Email domains
                  </dt>
                  <dd className="text-stone-800 break-words">{domainsLabel(p)}</dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Updated
                  </dt>
                  <dd className="text-stone-800">
                    <LocalTime value={p.updated_at} style="date" />
                  </dd>
                  <dt className="mt-2 text-xs font-medium text-stone-500 sm:mt-0 sm:pt-0.5">
                    Redirect URI
                  </dt>
                  <dd className="space-y-1">
                    <code
                      data-testid="provider-callback"
                      className="block font-mono text-xs text-stone-800 break-all"
                    >
                      {url}
                    </code>
                    <button type="button" onClick={() => copy(p.id, url)} className={secondaryBtn}>
                      {copied === p.id ? "Copied" : "Copy"}
                    </button>
                    {i === 0 && (
                      <p className="text-xs text-stone-500">
                        Register this address with the provider.
                      </p>
                    )}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <a href={editHref(p.id)} className={secondaryBtn}>
                    Edit
                  </a>
                  <button
                    type="button"
                    onClick={(e) => {
                      removeTrigger.current = e.currentTarget;
                      setRemoving(p);
                    }}
                    className={dangerBtn}
                  >
                    Remove…
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {removing && (
        <RemoveProviderDialog
          name={removing.name}
          pending={isDeleting}
          onCancel={cancelRemove}
          action={deleteAction}
        />
      )}
    </section>
  );
}

/**
 * The confirmation before a removal (COPY B-16..B-18). Focus starts on
 * Cancel and stays inside; Esc is Cancel.
 */
export function RemoveProviderDialog({
  name,
  pending,
  onCancel,
  action,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  action: (formData: FormData) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!pending) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sky-950/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-xl"
      >
        <h3 id={titleId} className="text-base font-semibold text-sky-950 break-words">
          {`Remove ${name}?`}
        </h3>
        <p id={bodyId} className="mt-2 text-sm text-stone-600 leading-relaxed">
          Members who sign in with it will need another way to sign in. Their accounts stay.
        </p>
        <form action={action} className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={secondaryBtn}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-2"
          >
            {pending ? "Removing…" : "Remove provider"}
          </button>
        </form>
      </div>
    </div>
  );
}
