"use client";

/**
 * PasskeySection — self-service WebAuthn/passkey credential management.
 *
 * Reusable across all authenticated user roles (site_admin, org_admin, org_user).
 * The backend enforces that all operations are scoped to the calling user's session;
 * no user ID is submitted from the browser.
 *
 * SECURITY:
 *   - challenge/session_id are WebAuthn ceremony identifiers, not user auth tokens.
 *   - No credential private key material ever reaches this component — only public
 *     summary data (credential id, nickname, created_at, last_used_at, aaguid) is stored.
 *   - Challenge session_id is passed as a query param because the finish endpoint
 *     body carries the attestation blob; it is a short-lived opaque identifier.
 *   - attestationObject and clientDataJSON blobs are sent to the server and then
 *     discarded from component state — they are NOT logged or stored in the browser.
 *   - Nickname is a display-only label; the server sanitizes it before storage.
 */

import { useEffect, useState } from "react";
import { IDP_PATHS } from "@/lib/idp-paths";
import { Button } from "./button";
import { LocalTime } from "./local-time";
import { arrayBufferToBase64url, base64urlToArrayBuffer } from "./passkey-base64url";
import { classifyPasskeyEnrollmentError } from "./passkey-enrollment-errors";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CredentialSummary {
  id: string;
  nickname: string;
  created_at: string;
  last_used_at: string | null;
  aaguid: string;
  clone_warning: boolean;
}

type Phase = "idle" | "loading" | "registering" | "success" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export function PasskeySection() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // "Add passkey" form state — only shown while isAdding=true.
  const [isAdding, setIsAdding] = useState(false);
  const [nickname, setNickname] = useState("");

  // Hydration-safe WebAuthn capability probe (THE-ELEVEN-MISMATCHES,
  // 2026-09-15). This read `typeof window !== "undefined" && …` at RENDER
  // time: false on the server, true on the browser's first render, so the
  // server HTML had no "Add passkey" button and the client's did — React's
  // "Hydration failed because the server rendered HTML didn't match the
  // client", once per visit of the passkeys tab, eleven per e2e mint from
  // 2026-09-10, invisible to every gate. WebAuthn capability is GENUINELY
  // client-only — no server can know the browser's authenticator — so the
  // honest server render is "not yet known" (no button) and the client's
  // first render must agree. useEffect runs after hydration; the button
  // appears post-mount on capable browsers, exactly as LoginFlow does it.
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  // refresh reloads the credential list. By default it resets phase to
  // "idle" so the initial mount transitions out of the "loading" state.
  // Callers that have ALREADY set a terminal phase ("success" / "error")
  // and need that phase to remain observable across the credential
  // re-fetch pass `preservePhase: true` so the finally clause does not
  // overwrite their phase. The post-success setTimeout in
  // handleAddPasskey is what eventually returns the banner to idle.
  async function refresh(opts?: { preservePhase?: boolean }) {
    try {
      const res = await fetch(IDP_PATHS.webauthnCredentials, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
        const data: any = await res.json();
        // The OSS handler returns a bare JSON array; the CE handler
        // returns an envelope `{ "credentials": [...] }`. Accept both
        // shapes so this component renders correctly against either
        // backend without coupling the UI to one wire-level decision.
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.credentials)
            ? data.credentials
            : [];
        setCredentials(list);
      }
    } catch {
      // Non-fatal — show empty list.
    } finally {
      if (!opts?.preservePhase) {
        setPhase("idle");
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is intentionally stable
  useEffect(() => {
    refresh();
  }, []);

  async function handleAddPasskey() {
    if (!isSupported) return;

    setPhase("registering");
    setError(null);

    try {
      const beginRes = await fetch(IDP_PATHS.webauthnRegisterBegin, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      if (!beginRes.ok) {
        throw Object.assign(new Error("begin_failed"), {
          __passkeyBeginStatus: beginRes.status,
        });
      }

      // biome-ignore lint/suspicious/noExplicitAny: raw WebAuthn options from server
      const beginData: any = await beginRes.json();
      const opts = beginData.publicKey;
      const sessionId: string = beginData.session_id;

      const creationOptions: PublicKeyCredentialCreationOptions = {
        ...opts,
        challenge: base64urlToArrayBuffer(opts.challenge),
        user: {
          ...opts.user,
          id: base64urlToArrayBuffer(opts.user.id),
        },
        excludeCredentials: (opts.excludeCredentials ?? []).map(
          // biome-ignore lint/suspicious/noExplicitAny: credential descriptor from server
          (c: any) => ({ ...c, id: base64urlToArrayBuffer(c.id) })
        ),
      };

      const credential = (await navigator.credentials.create({
        publicKey: creationOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw Object.assign(new Error("ceremony_cancelled"), {
          __passkeyCeremonyCancelled: true,
        });
      }

      const attResp = credential.response as AuthenticatorAttestationResponse;

      const payload = {
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(attResp.clientDataJSON),
          attestationObject: arrayBufferToBase64url(attResp.attestationObject),
          transports: attResp.getTransports?.() ?? [],
        },
      };

      // Nickname is appended as a query param so the body stays as the raw
      // WebAuthn attestation blob expected by the go-webauthn library.
      const nicknameParam = nickname.trim()
        ? `&nickname=${encodeURIComponent(nickname.trim())}`
        : "";

      const finishRes = await fetch(
        `${IDP_PATHS.webauthnRegisterFinish}?session_id=${encodeURIComponent(sessionId)}${nicknameParam}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        }
      );

      if (!finishRes.ok) {
        // Do NOT forward the IDP's raw message field — it may be the
        // generic "An error occurred. Please try again later." string
        // which is the IDP's 500 fallback and gives the operator no
        // actionable next step. Throw a sentinel tagged with the
        // HTTP status so the catch block can map it through the
        // helper to a vetted UI copy string.
        throw Object.assign(new Error("finish_failed"), {
          __passkeyFinishStatus: finishRes.status,
        });
      }

      setNickname("");
      setIsAdding(false);
      setPhase("success");
      // preservePhase keeps the "success" banner visible across the
      // credential-list re-fetch so Playwright (and human operators)
      // can observe it. The setTimeout below owns the eventual return
      // to "idle".
      await refresh({ preservePhase: true });
      setTimeout(() => setPhase("idle"), 3000);
    } catch (err) {
      setError(classifyPasskeyEnrollmentError(err));
      setPhase("error");
      setIsAdding(false);
    }
  }

  async function handleDeletePasskey(credId: string) {
    setDeletingId(credId);
    try {
      const res = await fetch(`${IDP_PATHS.webauthnCredentials}/${encodeURIComponent(credId)}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok || res.status === 204) {
        setCredentials((prev) => prev.filter((c) => c.id !== credId));
      }
    } catch {
      // Non-fatal.
    } finally {
      setDeletingId(null);
    }
  }

  const isRegistering = phase === "registering";

  return (
    <div className="space-y-4">
      {/* Header row — description + Add passkey trigger */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-stone-400 leading-relaxed">
          Sign in with your device fingerprint, face, or a security key — no password required.
        </p>
        {isSupported && !isAdding && (
          <Button
            size="sm"
            disabled={phase === "loading"}
            onClick={() => {
              setIsAdding(true);
              setError(null);
            }}
            className="shrink-0"
          >
            Add passkey
          </Button>
        )}
      </div>

      {/* Add-passkey inline form — only visible when isAdding */}
      {isSupported && isAdding && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 80))}
            placeholder='Nickname (optional, e.g. "MacBook Touch ID")'
            maxLength={80}
            disabled={isRegistering}
            // biome-ignore lint/a11y/noAutofocus: intentional — user just clicked Add passkey
            autoFocus
            className="flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-sky-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors disabled:opacity-50"
          />
          <Button size="sm" loading={isRegistering} onClick={handleAddPasskey} className="shrink-0">
            {isRegistering ? "Follow device prompt…" : "Add"}
          </Button>
          {!isRegistering && (
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNickname("");
              }}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Success banner */}
      {phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-700">Passkey added successfully.</p>
          <p className="text-xs text-stone-500 mt-0.5">
            You can now use this passkey to sign in on supported browsers.
          </p>
        </div>
      )}

      {/* Error banner */}
      {phase === "error" && error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Credential list */}
      {phase === "loading" ? (
        <p className="text-xs text-stone-400">Loading…</p>
      ) : credentials.length === 0 ? (
        <p className="text-xs text-stone-400">No passkeys enrolled yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {credentials.map((cred) => (
            <CredentialRow
              key={cred.id}
              cred={cred}
              isDeleting={deletingId === cred.id}
              onDelete={() => handleDeletePasskey(cred.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CredentialRow({
  cred,
  isDeleting,
  onDelete,
}: {
  cred: CredentialSummary;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const shortId = cred.id.replace(/-/g, "").slice(0, 8);
  const shortAaguid =
    cred.aaguid && cred.aaguid !== "00000000-0000-0000-0000-000000000000"
      ? cred.aaguid.replace(/-/g, "").slice(0, 8)
      : null;

  return (
    <li className="py-3 space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-sky-950 font-medium truncate">
            {cred.nickname || "Device passkey"}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">
            Added <LocalTime value={cred.created_at} style="date" />
            {cred.last_used_at && (
              <>
                {" · Last used "}
                <LocalTime value={cred.last_used_at} style="date" />
              </>
            )}
          </p>
          <p className="text-[11px] font-mono text-stone-300 mt-0.5">
            {shortId}
            {shortAaguid && <span className="ml-2">· {shortAaguid}</span>}
          </p>
          {cred.clone_warning && (
            <p className="text-xs font-medium text-amber-600 mt-0.5">
              Clone warning — possible key duplication detected.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-xs text-stone-400 hover:text-red-600 font-medium transition-colors disabled:opacity-50"
            aria-label="Remove passkey"
          >
            {isDeleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </li>
  );
}
